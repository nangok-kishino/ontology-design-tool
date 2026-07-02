// クラス定義・リレーション定義・インスタンスのインポート/エクスポート（YAML）
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml"
import type {
  OntologyClass,
  OntologyRelation,
  OntologyAttribute,
  OntologyInstance,
  AttributeRequired,
} from "./types"

export type ImportMode = "diff" | "replace"

const VALID_DATA_TYPES = ["文字列", "数値", "日付", "真偽値"]
const VALID_REQUIRED: AttributeRequired[] = ["必須", "任意"]

export type AttrExport = {
  name: string
  dataType: string
  required: AttributeRequired
  description?: string
}

export type ClassExportItem = {
  name: string
  nameEn?: string
  description?: string
  parent: string | null
  attributes: AttrExport[]
}

export type RelationExportItem = {
  name: string
  nameEn?: string
  description?: string
  parentRelation: string | null
  classPairs: { source: string; target: string }[]
  attributes: AttrExport[]
}

export type InstanceExportItem = {
  name: string
  class: string | null
  attributes: Record<string, string>
}

export type ParseResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; errors: string[] }

export type ImportPreview = {
  toCreate: string[]
  toUpdate: string[]
  toDelete: string[]
  errors: string[]
}

function toAttrExport(attrs: OntologyAttribute[]): AttrExport[] {
  return attrs.map((a) => ({
    name: a.name,
    dataType: a.dataType,
    required: a.required,
    ...(a.description ? { description: a.description } : {}),
  }))
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

export function buildClassesYaml(
  classes: OntologyClass[],
  attrsByClassId: Map<string, OntologyAttribute[]>,
): string {
  const classesById = new Map(classes.map((c) => [c.id, c]))
  const items: ClassExportItem[] = classes.map((c) => ({
    name: c.name,
    nameEn: c.nameEn ?? "",
    description: c.description ?? "",
    parent: c.parentId ? (classesById.get(c.parentId)?.name ?? null) : null,
    attributes: toAttrExport(attrsByClassId.get(c.id) ?? []),
  }))
  return stringifyYaml({ classes: items }, { indent: 2 })
}

export function buildRelationsYaml(
  relations: OntologyRelation[],
  classesById: Map<string, OntologyClass>,
  attrsByRelationId: Map<string, OntologyAttribute[]>,
): string {
  const relationsById = new Map(relations.map((r) => [r.id, r]))
  const items: RelationExportItem[] = relations.map((r) => ({
    name: r.name,
    nameEn: r.nameEn ?? "",
    description: r.description ?? "",
    parentRelation: r.parentRelationId
      ? (relationsById.get(r.parentRelationId)?.name ?? null)
      : null,
    classPairs: (r.classPairs ?? []).map((p) => ({
      source: classesById.get(p.sourceClassId)?.name ?? p.sourceClassId,
      target: classesById.get(p.targetClassId)?.name ?? p.targetClassId,
    })),
    attributes: toAttrExport(attrsByRelationId.get(r.id) ?? []),
  }))
  return stringifyYaml({ relations: items }, { indent: 2 })
}

export function buildInstancesYaml(
  instances: OntologyInstance[],
  classesById: Map<string, OntologyClass>,
  attrIdToName: Map<string, string>,
): string {
  const items: InstanceExportItem[] = instances.map((inst) => {
    const cls = inst.classId ? classesById.get(inst.classId) : undefined
    const attributes: Record<string, string> = {}
    for (const [attrId, value] of Object.entries(inst.attributes ?? {})) {
      const name = attrIdToName.get(attrId)
      if (name) attributes[name] = value
    }
    return {
      name: inst.name,
      class: cls ? cls.name : null,
      attributes,
    }
  })
  return stringifyYaml({ instances: items }, { indent: 2 })
}

export function downloadYaml(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// パース・検証
// ---------------------------------------------------------------------------

function parseAttributes(raw: any, ownerLabel: string, errors: string[]): AttrExport[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push(`「${ownerLabel}」の attributes は配列で指定してください`)
    return []
  }
  const seen = new Set<string>()
  const result: AttrExport[] = []
  raw.forEach((a: any, i: number) => {
    const label = `「${ownerLabel}」の attributes[${i}]`
    if (!a || typeof a.name !== "string" || !a.name.trim()) {
      errors.push(`${label} に name がありません`)
      return
    }
    const name = a.name.trim()
    if (seen.has(name)) {
      errors.push(`「${ownerLabel}」の属性名「${name}」が重複しています`)
      return
    }
    seen.add(name)
    if (typeof a.dataType !== "string" || !VALID_DATA_TYPES.includes(a.dataType)) {
      errors.push(`${label}（${name}）の dataType は ${VALID_DATA_TYPES.join("/")} のいずれかで指定してください`)
      return
    }
    const required = a.required ?? "任意"
    if (!VALID_REQUIRED.includes(required)) {
      errors.push(`${label}（${name}）の required は 必須/任意 のいずれかで指定してください`)
      return
    }
    result.push({
      name,
      dataType: a.dataType,
      required,
      description: typeof a.description === "string" ? a.description : "",
    })
  })
  return result
}

export function parseClassesYaml(text: string): ParseResult<ClassExportItem> {
  const errors: string[] = []
  let data: any
  try {
    data = parseYamlText(text)
  } catch (e: any) {
    return { ok: false, errors: [`YAMLの解析に失敗しました: ${e?.message ?? e}`] }
  }
  const rawClasses = data?.classes
  if (!Array.isArray(rawClasses)) {
    return { ok: false, errors: ["トップレベルに classes（配列）がありません"] }
  }
  const seenNames = new Set<string>()
  const items: ClassExportItem[] = []
  rawClasses.forEach((c: any, i: number) => {
    if (!c || typeof c.name !== "string" || !c.name.trim()) {
      errors.push(`classes[${i}] に name がありません`)
      return
    }
    const name = c.name.trim()
    if (seenNames.has(name)) {
      errors.push(`クラス名「${name}」が重複しています`)
      return
    }
    seenNames.add(name)
    const parent = c.parent === undefined || c.parent === null || c.parent === "" ? null : String(c.parent).trim()
    items.push({
      name,
      nameEn: typeof c.nameEn === "string" ? c.nameEn : "",
      description: typeof c.description === "string" ? c.description : "",
      parent,
      attributes: parseAttributes(c.attributes, name, errors),
    })
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, items }
}

export function parseRelationsYaml(text: string): ParseResult<RelationExportItem> {
  const errors: string[] = []
  let data: any
  try {
    data = parseYamlText(text)
  } catch (e: any) {
    return { ok: false, errors: [`YAMLの解析に失敗しました: ${e?.message ?? e}`] }
  }
  const rawRelations = data?.relations
  if (!Array.isArray(rawRelations)) {
    return { ok: false, errors: ["トップレベルに relations（配列）がありません"] }
  }
  const seenNames = new Set<string>()
  const items: RelationExportItem[] = []
  rawRelations.forEach((r: any, i: number) => {
    if (!r || typeof r.name !== "string" || !r.name.trim()) {
      errors.push(`relations[${i}] に name がありません`)
      return
    }
    const name = r.name.trim()
    if (seenNames.has(name)) {
      errors.push(`リレーション名「${name}」が重複しています`)
      return
    }
    seenNames.add(name)
    const rawPairs = r.classPairs
    if (!Array.isArray(rawPairs) || rawPairs.length === 0) {
      errors.push(`「${name}」の classPairs は1件以上指定してください`)
      return
    }
    const classPairs: { source: string; target: string }[] = []
    rawPairs.forEach((p: any, j: number) => {
      if (!p || typeof p.source !== "string" || !p.source.trim() || typeof p.target !== "string" || !p.target.trim()) {
        errors.push(`「${name}」の classPairs[${j}] に source/target が必要です`)
        return
      }
      classPairs.push({ source: p.source.trim(), target: p.target.trim() })
    })
    const parentRelation = r.parentRelation === undefined || r.parentRelation === null || r.parentRelation === ""
      ? null
      : String(r.parentRelation).trim()
    items.push({
      name,
      nameEn: typeof r.nameEn === "string" ? r.nameEn : "",
      description: typeof r.description === "string" ? r.description : "",
      parentRelation,
      classPairs,
      attributes: parseAttributes(r.attributes, name, errors),
    })
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, items }
}

export function parseInstancesYaml(text: string): ParseResult<InstanceExportItem> {
  const errors: string[] = []
  let data: any
  try {
    data = parseYamlText(text)
  } catch (e: any) {
    return { ok: false, errors: [`YAMLの解析に失敗しました: ${e?.message ?? e}`] }
  }
  const rawInstances = data?.instances
  if (!Array.isArray(rawInstances)) {
    return { ok: false, errors: ["トップレベルに instances（配列）がありません"] }
  }
  const items: InstanceExportItem[] = []
  rawInstances.forEach((i: any, idx: number) => {
    if (!i || typeof i.name !== "string" || !i.name.trim()) {
      errors.push(`instances[${idx}] に name がありません`)
      return
    }
    const name = i.name.trim()
    if (i.class !== undefined && i.class !== null && typeof i.class !== "string") {
      errors.push(`「${name}」の class は文字列または null で指定してください`)
      return
    }
    const cls = i.class === undefined || i.class === null || i.class === "" ? null : String(i.class).trim()
    const rawAttrs = i.attributes
    const attributes: Record<string, string> = {}
    if (rawAttrs !== undefined && rawAttrs !== null) {
      if (typeof rawAttrs !== "object" || Array.isArray(rawAttrs)) {
        errors.push(`「${name}」の attributes はマップ（属性名: 値）で指定してください`)
        return
      }
      for (const [k, v] of Object.entries(rawAttrs)) {
        attributes[k] = v === null || v === undefined ? "" : String(v)
      }
    }
    items.push({ name, class: cls, attributes })
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, items }
}

// ---------------------------------------------------------------------------
// プレビュー（実行前の差分表示・参照検証）
// ---------------------------------------------------------------------------

export function previewClassesImport(
  fileItems: ClassExportItem[],
  existing: OntologyClass[],
  mode: ImportMode,
): ImportPreview {
  const errors: string[] = []
  const fileNames = new Set(fileItems.map((c) => c.name))
  const existingNames = new Set(existing.map((c) => c.name))
  const survivorNames = mode === "replace"
    ? fileNames
    : new Set([...fileNames, ...existingNames])

  const toCreate: string[] = []
  const toUpdate: string[] = []
  for (const item of fileItems) {
    if (existingNames.has(item.name)) {
      if (mode === "replace") toUpdate.push(item.name)
      // diff モードでは既存クラスの基本情報は変更しない（属性のみ追加対象になり得る）
    } else {
      toCreate.push(item.name)
    }
    if (item.parent && !survivorNames.has(item.parent)) {
      errors.push(`「${item.name}」の親クラス「${item.parent}」が見つかりません（ファイルに未定義、または削除対象です）`)
    }
  }

  const toDelete = mode === "replace"
    ? existing.filter((c) => !fileNames.has(c.name)).map((c) => c.name)
    : []

  return { toCreate, toUpdate, toDelete, errors }
}

export function previewRelationsImport(
  fileItems: RelationExportItem[],
  existing: OntologyRelation[],
  existingClasses: OntologyClass[],
  mode: ImportMode,
): ImportPreview {
  const errors: string[] = []
  const fileNames = new Set(fileItems.map((r) => r.name))
  const existingNames = new Set(existing.map((r) => r.name))
  const survivorNames = mode === "replace"
    ? fileNames
    : new Set([...fileNames, ...existingNames])
  const classNames = new Set(existingClasses.map((c) => c.name))

  const toCreate: string[] = []
  const toUpdate: string[] = []
  for (const item of fileItems) {
    if (existingNames.has(item.name)) {
      if (mode === "replace") toUpdate.push(item.name)
    } else {
      toCreate.push(item.name)
    }
    if (item.parentRelation && !survivorNames.has(item.parentRelation)) {
      errors.push(`「${item.name}」の親リレーション「${item.parentRelation}」が見つかりません（ファイルに未定義、または削除対象です）`)
    }
    for (const pair of item.classPairs) {
      if (!classNames.has(pair.source)) {
        errors.push(`「${item.name}」の始点クラス「${pair.source}」が見つかりません。先にクラスを登録してください`)
      }
      if (!classNames.has(pair.target)) {
        errors.push(`「${item.name}」の終点クラス「${pair.target}」が見つかりません。先にクラスを登録してください`)
      }
    }
  }

  const toDelete = mode === "replace"
    ? existing.filter((r) => !fileNames.has(r.name)).map((r) => r.name)
    : []

  return { toCreate, toUpdate, toDelete, errors }
}

type AttributeContext = {
  projectAttrs: OntologyAttribute[]
  byClassId: Map<string, OntologyAttribute[]>
}

async function fetchAttributeContext(projectId: string, classes: OntologyClass[]): Promise<AttributeContext> {
  const [projectAttrs, perClass] = await Promise.all([
    fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
    Promise.all(classes.map(async (c) => {
      const attrs = await fetch(`/api/attributes?targetId=${c.id}`).then((r) => r.json())
      return [c.id, Array.isArray(attrs) ? attrs : []] as const
    })),
  ])
  return {
    projectAttrs: Array.isArray(projectAttrs) ? projectAttrs : [],
    byClassId: new Map(perClass),
  }
}

// 未分類インスタンスにはクラス固有属性の概念がないため、プロジェクト共通属性のみが対象になる
function applicableAttributes(cls: OntologyClass | null, ctx: AttributeContext): OntologyAttribute[] {
  if (!cls) return ctx.projectAttrs
  const own = ctx.byClassId.get(cls.id) ?? []
  const inherited = cls.parentId ? (ctx.byClassId.get(cls.parentId) ?? []) : []
  return [...ctx.projectAttrs, ...inherited, ...own]
}

function instanceKey(className: string | null, name: string): string {
  return `${className ?? " "}::${name}`
}

export async function previewInstancesImport(
  fileItems: InstanceExportItem[],
  existing: OntologyInstance[],
  existingClasses: OntologyClass[],
  projectId: string,
  mode: ImportMode,
): Promise<ImportPreview> {
  const errors: string[] = []
  const classByName = new Map(existingClasses.map((c) => [c.name, c]))
  const classById = new Map(existingClasses.map((c) => [c.id, c]))
  const ctx = await fetchAttributeContext(projectId, existingClasses)

  const seenKeys = new Set<string>()
  for (const item of fileItems) {
    const key = instanceKey(item.class, item.name)
    if (seenKeys.has(key)) {
      errors.push(`「${item.class ?? "未分類"} / ${item.name}」がファイル内で重複しています`)
      continue
    }
    seenKeys.add(key)

    let cls: OntologyClass | null = null
    if (item.class !== null) {
      cls = classByName.get(item.class) ?? null
      if (!cls) {
        errors.push(`「${item.name}」のクラス「${item.class}」が見つかりません。未定義のクラスは指定できません（未分類にする場合は class: null としてください）`)
        continue
      }
    }
    const allowedAttrNames = new Set(applicableAttributes(cls, ctx).map((a) => a.name))
    for (const attrName of Object.keys(item.attributes)) {
      if (!allowedAttrNames.has(attrName)) {
        errors.push(`「${item.name}」の属性「${attrName}」は${cls ? `クラス「${cls.name}」` : "未分類"}に定義されていません`)
      }
    }
  }

  const existingClassNameOf = (inst: OntologyInstance): string | null =>
    inst.classId ? (classById.get(inst.classId)?.name ?? null) : null
  const existingKeys = new Set(existing.map((inst) => instanceKey(existingClassNameOf(inst), inst.name)))
  const fileKeys = new Set(fileItems.map((i) => instanceKey(i.class, i.name)))

  const toCreate = fileItems.filter((i) => !existingKeys.has(instanceKey(i.class, i.name))).map((i) => i.name)
  const toUpdate = mode === "replace"
    ? fileItems.filter((i) => existingKeys.has(instanceKey(i.class, i.name))).map((i) => i.name)
    : []
  const toDelete = mode === "replace"
    ? existing.filter((inst) => !fileKeys.has(instanceKey(existingClassNameOf(inst), inst.name))).map((inst) => inst.name)
    : []

  return { toCreate, toUpdate, toDelete, errors }
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function putJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function syncAttributes(
  targetId: string,
  projectId: string,
  targetType: "class" | "relation",
  fileAttrs: AttrExport[],
  mode: ImportMode,
) {
  const current: OntologyAttribute[] = await fetch(`/api/attributes?targetId=${targetId}`).then((r) => r.json())
  const byName = new Map(current.map((a) => [a.name, a]))
  for (const attr of fileAttrs) {
    const existingAttr = byName.get(attr.name)
    if (existingAttr) {
      byName.delete(attr.name)
      if (mode === "replace") {
        await putJson(`/api/attributes/${existingAttr.id}`, {
          name: attr.name,
          description: attr.description ?? "",
          dataType: attr.dataType,
          required: attr.required,
        })
      }
      // diff モードでは既存属性は変更しない
    } else {
      await postJson("/api/attributes", {
        projectId,
        name: attr.name,
        description: attr.description ?? "",
        dataType: attr.dataType,
        required: attr.required,
        scope: "固有",
        targetId,
        targetType,
      })
    }
  }
  if (mode === "replace") {
    for (const leftover of byName.values()) {
      await fetch(`/api/attributes/${leftover.id}`, { method: "DELETE" })
    }
  }
}

export type ClassImportSummary = {
  created: number
  updated: number
  deleted: number
  unclassifiedInstances: number
}

export async function executeClassesImport(
  projectId: string,
  fileItems: ClassExportItem[],
  existing: OntologyClass[],
  mode: ImportMode,
): Promise<ClassImportSummary> {
  const nameToId = new Map(existing.map((c) => [c.name, c.id]))
  const existingNames = new Set(existing.map((c) => c.name))
  let created = 0
  let updated = 0

  // Phase 1: 新規クラスの作成（親IDは後で解決するため一旦 null）
  for (const item of fileItems) {
    if (!nameToId.has(item.name)) {
      const createdClass = await postJson("/api/classes", {
        projectId,
        name: item.name,
        nameEn: item.nameEn ?? "",
        description: item.description ?? "",
        parentId: null,
      })
      nameToId.set(item.name, createdClass.id)
      created++
    }
  }

  // Phase 2: 基本情報・親クラスの更新（全差替え時、または diff で新規作成した分のみ）
  for (const item of fileItems) {
    const id = nameToId.get(item.name)!
    const parentId = item.parent ? (nameToId.get(item.parent) ?? null) : null
    const isNew = !existingNames.has(item.name)
    if (isNew) {
      await putJson(`/api/classes/${id}`, {
        name: item.name,
        nameEn: item.nameEn ?? "",
        description: item.description ?? "",
        parentId,
      })
    } else if (mode === "replace") {
      await putJson(`/api/classes/${id}`, {
        name: item.name,
        nameEn: item.nameEn ?? "",
        description: item.description ?? "",
        parentId,
      })
      updated++
    }
  }

  // Phase 3: 属性の同期
  for (const item of fileItems) {
    const id = nameToId.get(item.name)!
    await syncAttributes(id, projectId, "class", item.attributes, mode)
  }

  // Phase 4: 全差替え時のみ、ファイルに存在しない既存クラスを削除
  let deleted = 0
  let unclassifiedInstances = 0
  if (mode === "replace") {
    const fileNames = new Set(fileItems.map((c) => c.name))
    const toDelete = existing.filter((c) => !fileNames.has(c.name))
    for (const cls of toDelete) {
      const instances: { id: string }[] = await fetch(`/api/instances?classId=${cls.id}`).then((r) => r.json())
      if (Array.isArray(instances)) {
        for (const inst of instances) {
          await putJson(`/api/instances/${inst.id}`, { classId: null })
          unclassifiedInstances++
        }
      }
      const attrs: OntologyAttribute[] = await fetch(`/api/attributes?targetId=${cls.id}`).then((r) => r.json())
      if (Array.isArray(attrs)) {
        for (const attr of attrs) {
          await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
        }
      }
      await fetch(`/api/classes/${cls.id}`, { method: "DELETE" })
      deleted++
    }
  }

  return { created, updated, deleted, unclassifiedInstances }
}

export type RelationImportSummary = {
  created: number
  updated: number
  deleted: number
}

export async function executeRelationsImport(
  projectId: string,
  fileItems: RelationExportItem[],
  existing: OntologyRelation[],
  existingClasses: OntologyClass[],
  mode: ImportMode,
): Promise<RelationImportSummary> {
  const classNameToId = new Map(existingClasses.map((c) => [c.name, c.id]))
  const nameToId = new Map(existing.map((r) => [r.name, r.id]))
  const existingNames = new Set(existing.map((r) => r.name))
  let created = 0
  let updated = 0

  // Phase 1: 新規リレーションの作成
  for (const item of fileItems) {
    if (!nameToId.has(item.name)) {
      const createdRel = await postJson("/api/relations", {
        projectId,
        name: item.name,
        nameEn: item.nameEn ?? "",
        description: item.description ?? "",
        classPairs: [],
        parentRelationId: null,
      })
      nameToId.set(item.name, createdRel.id)
      created++
    }
  }

  // Phase 2: 基本情報・クラスペア・親リレーションの更新
  for (const item of fileItems) {
    const id = nameToId.get(item.name)!
    const isNew = !existingNames.has(item.name)
    if (isNew || mode === "replace") {
      const classPairs = item.classPairs.map((p) => ({
        sourceClassId: classNameToId.get(p.source) ?? "",
        targetClassId: classNameToId.get(p.target) ?? "",
      }))
      const parentRelationId = item.parentRelation ? (nameToId.get(item.parentRelation) ?? null) : null
      await putJson(`/api/relations/${id}`, {
        name: item.name,
        nameEn: item.nameEn ?? "",
        description: item.description ?? "",
        classPairs,
        parentRelationId,
      })
      if (!isNew) updated++
    }
  }

  // Phase 3: 属性の同期
  for (const item of fileItems) {
    const id = nameToId.get(item.name)!
    await syncAttributes(id, projectId, "relation", item.attributes, mode)
  }

  // Phase 4: 全差替え時のみ、ファイルに存在しない既存リレーションを削除
  let deleted = 0
  if (mode === "replace") {
    const fileNames = new Set(fileItems.map((r) => r.name))
    const toDelete = existing.filter((r) => !fileNames.has(r.name))
    for (const rel of toDelete) {
      const attrs: OntologyAttribute[] = await fetch(`/api/attributes?targetId=${rel.id}`).then((r) => r.json())
      if (Array.isArray(attrs)) {
        for (const attr of attrs) {
          await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
        }
      }
      await fetch(`/api/relations/${rel.id}`, { method: "DELETE" })
      deleted++
    }
  }

  return { created, updated, deleted }
}

export type InstanceImportSummary = {
  created: number
  updated: number
  deleted: number
}

export async function executeInstancesImport(
  projectId: string,
  fileItems: InstanceExportItem[],
  existing: OntologyInstance[],
  existingClasses: OntologyClass[],
  mode: ImportMode,
): Promise<InstanceImportSummary> {
  const classByName = new Map(existingClasses.map((c) => [c.name, c]))
  const classById = new Map(existingClasses.map((c) => [c.id, c]))
  const ctx = await fetchAttributeContext(projectId, existingClasses)

  const existingClassNameOf = (inst: OntologyInstance): string | null =>
    inst.classId ? (classById.get(inst.classId)?.name ?? null) : null
  const existingByKey = new Map(existing.map((inst) => [instanceKey(existingClassNameOf(inst), inst.name), inst]))

  let created = 0
  let updated = 0
  const usedKeys = new Set<string>()

  for (const item of fileItems) {
    const key = instanceKey(item.class, item.name)
    usedKeys.add(key)
    const cls = item.class !== null ? (classByName.get(item.class) ?? null) : null
    const classId = cls ? cls.id : null
    const attrNameToId = new Map(applicableAttributes(cls, ctx).map((a) => [a.name, a.id]))
    const attributes: Record<string, string> = {}
    for (const [attrName, value] of Object.entries(item.attributes)) {
      const attrId = attrNameToId.get(attrName)
      if (attrId) attributes[attrId] = value
    }

    const existingInst = existingByKey.get(key)
    if (!existingInst) {
      await postJson("/api/instances", { projectId, classId, name: item.name, attributes })
      created++
    } else if (mode === "replace") {
      await putJson(`/api/instances/${existingInst.id}`, { name: item.name, classId, attributes })
      updated++
    }
  }

  let deleted = 0
  if (mode === "replace") {
    for (const inst of existing) {
      if (!usedKeys.has(instanceKey(existingClassNameOf(inst), inst.name))) {
        await fetch(`/api/instances/${inst.id}`, { method: "DELETE" })
        deleted++
      }
    }
  }

  return { created, updated, deleted }
}
