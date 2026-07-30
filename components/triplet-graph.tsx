"use client"

// トリプレットのグラフ表示（サイバー風 force graph）のラッパー。
//   描画本体(triplet-graph-canvas)は window 依存のため ssr:false で動的読み込み。
//   コンテナの実サイズを測って canvas に渡す（ResizeObserver）。

import { useLayoutEffect, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import type { Triplet, OntologyInstance } from "@/lib/types"

const TripletGraphCanvas = dynamic(() => import("./triplet-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0b14]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
    </div>
  ),
})

export function TripletGraph({
  triplets,
  instById,
  classNameById,
  attrNameById,
  onSelectNode,
}: {
  triplets: Triplet[]
  instById: Map<string, OntologyInstance>
  classNameById: Map<string, string>
  attrNameById?: Map<string, string>
  onSelectNode?: (instanceId: string) => void
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
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0a0b14]">
      {triplets.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
          トリプレットが登録されていません
        </div>
      ) : size.w > 0 && size.h > 0 ? (
        <TripletGraphCanvas
          triplets={triplets}
          instById={instById}
          classNameById={classNameById}
          attrNameById={attrNameById}
          width={size.w}
          height={size.h}
          onSelectNode={onSelectNode}
        />
      ) : null}

      {/* 操作ヒント */}
      {triplets.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2.5 py-1 text-[11px] text-zinc-300 backdrop-blur-sm">
          ドラッグでノード移動 ／ ホイールでズーム ／ ホバーで隣接強調
        </div>
      )}
    </div>
  )
}
