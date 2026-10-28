"use client"

// スキーマ図（クラス＝ノード、リレーション＝エッジ）のラッパー。
//   描画本体(schema-graph-canvas)は window 依存のため ssr:false で動的読み込み。
//   コンテナの実サイズを測って canvas に渡す（ResizeObserver）。

import { useLayoutEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import type { OntologyClass, OntologyRelation } from "@/lib/types"

const SchemaGraphCanvas = dynamic(() => import("./schema-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0a1a2f]">
      <Loader2 className="h-6 w-6 animate-spin text-sky-200" />
    </div>
  ),
})

export function SchemaGraph({
  classes,
  relations,
  layoutKey,
}: {
  classes: OntologyClass[]
  relations: OntologyRelation[]
  layoutKey: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // 初回は同期計測、以降は ResizeObserver で追従
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0a1a2f]">
      {classes.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-sky-100/70">
          クラスが登録されていません
        </div>
      ) : size.w > 0 && size.h > 0 ? (
        <SchemaGraphCanvas classes={classes} relations={relations} layoutKey={layoutKey} width={size.w} height={size.h} />
      ) : null}

      {/* 操作ヒント */}
      {classes.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/30 px-2.5 py-1 text-[11px] text-sky-100/80 backdrop-blur-sm">
          ドラッグでクラス移動（配置は自動保存） ／ ホイールでズーム ／ ホバーで隣接強調
        </div>
      )}
    </div>
  )
}
