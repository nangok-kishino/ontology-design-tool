"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { TopBar } from "@/components/top-bar"
import { classInstanceRows, dashboardRelationRows } from "@/lib/ontology-data"
import { Download } from "lucide-react"

export function DashboardScreen() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="ダッシュボード" action={{ label: "OWL/RDF エクスポート", icon: Download }} />
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">クラス／インスタンス</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">クラス</TableHead>
                      <TableHead>インスタンス</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classInstanceRows.map((row) => (
                      <TableRow key={row.className}>
                        <TableCell className="font-medium text-foreground align-top">{row.className}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {row.instances.map((inst) => (
                              <Badge key={inst} variant="secondary" className="font-normal">
                                {inst}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">リレーション</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">リレーション</TableHead>
                      <TableHead>始点 → 終点</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardRelationRows.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                        <TableCell className="text-muted-foreground">{row.flow}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}
