import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { normalizeName } from "@/lib/normalize"
import {
  CONTAINERS,
  type GraphNode,
  type NameResolutionMethod,
  type NodeNameResolution,
  type Relationship,
} from "@/lib/graph-types"

const RESOLUTIONS = CONTAINERS.nodeNameResolutions

// 名寄せの「単一の出口」。すべての確定操作（人の承認結果）をここに集約する。
//   action=confirm : 未チェック → チェック済み（重複なし／別物として確定）。nodeIds[] を一括処理。
//   action=merge   : loserId を canonicalId に統合。loser は統合済みになり、辞書へ登録する。
//   action=unmerge : 統合済みノードを未チェックへ戻し、辞書エントリを削除する（取り消し）。
//
// 【原則】システムによる自動統合は一切しない。正規化で一致しても候補を出すだけで、
// 確定はここを通した人の承認に限る。統合は削除ではなく「代表＋別名」で残す。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId: string | undefined = body.projectId
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const actor = getPrincipalName(request)
    const nowIso = new Date().toISOString()
    const nodes = await getContainer(CONTAINERS.nodes)
    const resolutions = await getContainer(RESOLUTIONS)

    const readNode = async (id: string): Promise<GraphNode | null> => {
      const { resource } = await nodes.item(id, id).read<GraphNode>()
      return resource ?? null
    }

    // --- confirm: 未チェック → チェック済み ---
    if (body.action === "confirm") {
      const ids: string[] = Array.isArray(body.nodeIds) ? body.nodeIds : []
      let confirmed = 0
      for (const id of ids) {
        const node = await readNode(id)
        if (!node || node.projectId !== projectId) continue
        if (node.status === "merged") continue
        await nodes.item(id, id).replace({
          ...node, status: "confirmed", updatedBy: actor, updatedAt: nowIso,
        })
        confirmed++
      }
      return NextResponse.json({ confirmed })
    }

    // --- merge: loser を canonical に統合 ---
    if (body.action === "merge") {
      const loserId: string = body.loserId
      const canonicalId: string = body.canonicalId
      const method: NameResolutionMethod = body.method ?? "manual"
      if (!loserId || !canonicalId || loserId === canonicalId) {
        return NextResponse.json({ error: "loserId と canonicalId（別々）が必要です" }, { status: 400 })
      }
      const loser = await readNode(loserId)
      const canonical = await readNode(canonicalId)
      if (!loser || !canonical) return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 })
      if (loser.projectId !== projectId || canonical.projectId !== projectId) {
        return NextResponse.json({ error: "プロジェクトが一致しません" }, { status: 400 })
      }

      // 代表の別名に loser の名前とその別名を足す
      const aliasSet = new Set<string>(canonical.aliases ?? [])
      aliasSet.add(loser.name)
      for (const a of loser.aliases ?? []) aliasSet.add(a)

      // プロパティ値は自動では移さない。UI が人の選んだ結果を渡してきたときだけ差し替える。
      const canonicalProperties =
        body.canonicalProperties !== undefined ? body.canonicalProperties : canonical.properties

      // 統合は代表の名寄せチェックも済ませたことにする
      await nodes.item(canonicalId, canonicalId).replace({
        ...canonical,
        status: "confirmed",
        aliases: Array.from(aliasSet),
        properties: canonicalProperties,
        updatedBy: actor,
        updatedAt: nowIso,
      })
      await nodes.item(loserId, loserId).replace({
        ...loser,
        status: "merged",
        mergedInto: canonicalId,
        updatedBy: actor,
        updatedAt: nowIso,
      })

      // 名寄せ辞書へ登録（loser の元表記＋その別名）
      for (const alias of [loser.name, ...(loser.aliases ?? [])]) {
        const record: NodeNameResolution = {
          id: crypto.randomUUID(),
          projectId,
          // 辞書のスコープは代表のラベル集合に合わせる（先頭ラベル。無ければプロジェクト全体）
          labelId: (canonical.labelIds ?? [])[0] ?? null,
          alias,
          normalizedAlias: normalizeName(alias),
          canonicalNodeId: canonicalId,
          method,
          approvedBy: actor,
          approvedAt: nowIso,
        }
        await resolutions.items.create(record)
      }

      // loser を代表としていた既存の辞書エントリを canonical へ付け替える
      const { resources: pointingToLoser } = await resolutions.items
        .query<NodeNameResolution>({
          query: "SELECT * FROM c WHERE c.projectId = @p AND c.canonicalNodeId = @loser",
          parameters: [{ name: "@p", value: projectId }, { name: "@loser", value: loserId }],
        })
        .fetchAll()
      for (const r of pointingToLoser) {
        await resolutions.item(r.id, r.id).replace({ ...r, canonicalNodeId: canonicalId })
      }

      // loser が端になっていたリレーションシップを代表へ付け替える
      // （統合した以上、同じものを指しているため。スナップショットも更新する）
      const relContainer = await getContainer(CONTAINERS.relationships)
      const { resources: rels } = await relContainer.items
        .query<Relationship>({
          query:
            "SELECT * FROM c WHERE c.projectId = @p AND (c.startNodeId = @id OR c.endNodeId = @id)",
          parameters: [{ name: "@p", value: projectId }, { name: "@id", value: loserId }],
        })
        .fetchAll()
      for (const r of rels) {
        await relContainer.item(r.id, r.id).replace({
          ...r,
          startNodeId: r.startNodeId === loserId ? canonicalId : r.startNodeId,
          startNodeName: r.startNodeId === loserId ? canonical.name : r.startNodeName,
          startNodeLabelIds: r.startNodeId === loserId ? (canonical.labelIds ?? []) : r.startNodeLabelIds,
          endNodeId: r.endNodeId === loserId ? canonicalId : r.endNodeId,
          endNodeName: r.endNodeId === loserId ? canonical.name : r.endNodeName,
          endNodeLabelIds: r.endNodeId === loserId ? (canonical.labelIds ?? []) : r.endNodeLabelIds,
          updatedBy: actor,
          updatedAt: nowIso,
        })
      }

      return NextResponse.json({ merged: loserId, canonical: canonicalId, relinked: rels.length })
    }

    // --- unmerge: 統合の取り消し ---
    if (body.action === "unmerge") {
      const nodeId: string = body.nodeId
      const node = await readNode(nodeId)
      if (!node) return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 })
      if (node.projectId !== projectId) {
        return NextResponse.json({ error: "プロジェクトが一致しません" }, { status: 400 })
      }
      if (node.status !== "merged") {
        return NextResponse.json({ error: "統合済みのノードではありません" }, { status: 400 })
      }
      const canonicalId = node.mergedInto ?? null

      await nodes.item(nodeId, nodeId).replace({
        ...node, status: "provisional", mergedInto: null, updatedBy: actor, updatedAt: nowIso,
      })

      if (canonicalId) {
        const canonical = await readNode(canonicalId)
        if (canonical) {
          const removeSet = new Set<string>([node.name, ...(node.aliases ?? [])])
          await nodes.item(canonicalId, canonicalId).replace({
            ...canonical,
            aliases: (canonical.aliases ?? []).filter((a) => !removeSet.has(a)),
            updatedBy: actor,
            updatedAt: nowIso,
          })
        }
        const { resources: toDelete } = await resolutions.items
          .query<NodeNameResolution>({
            query:
              "SELECT * FROM c WHERE c.projectId = @p AND c.canonicalNodeId = @canon AND c.alias = @alias",
            parameters: [
              { name: "@p", value: projectId },
              { name: "@canon", value: canonicalId },
              { name: "@alias", value: node.name },
            ],
          })
          .fetchAll()
        for (const r of toDelete) await resolutions.item(r.id, r.id).delete()
      }

      // 付け替えたリレーションシップは戻さない（どれが元々どちらの分だったか決められないため）
      return NextResponse.json({ unmerged: nodeId })
    }

    return NextResponse.json({ error: "不明な action です" }, { status: 400 })
  } catch (error) {
    console.error("POST /api/nodes/resolve:", error)
    return NextResponse.json({ error: "名寄せの確定に失敗しました" }, { status: 500 })
  }
}
