import type { Student } from '../types'
import { uid } from './id'

// ================= 批量粘贴名单：解析 / 校验 / 转换（纯函数，便于单测） =================

export const HEIGHT_MIN = 90
export const HEIGHT_MAX = 220

export interface ParsedLine {
  lineNo: number // 非空行序号（从 1 开始）
  raw: string // 原始行文本（trim 后）
  name: string
  heightText: string
  note: string
}

// 字段分隔符：逗号 / 中文逗号 / 顿号 / 分号 / 制表符（兼容 Excel 直接粘贴）
const FIELD_SEP = /[,，、;；\t]/

export function parseRosterText(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const [name = '', heightText = '', ...rest] = line.split(FIELD_SEP).map((f) => f.trim())
    out.push({
      lineNo: out.length + 1,
      raw: line,
      name,
      heightText,
      // 超过 3 个字段时并入备注，不丢数据
      note: rest.filter(Boolean).join('，'),
    })
  }
  return out
}

export type ProblemType = 'missing' | 'height' | 'duplicate'

export interface RowProblem {
  type: ProblemType
  message: string
}

export interface AssessRow {
  lineNo: number
  name: string
  heightText: string
  include: boolean
}

// 身高校验：空 = 未填写（合法）；非数字 / 超出常见范围 = 问题
export function heightProblem(heightText: string): string | null {
  const t = heightText.trim()
  if (!t) return null
  if (!/^\d+(\.\d+)?$/.test(t)) return `身高「${t}」不是数字`
  const v = Number(t)
  if (v < HEIGHT_MIN || v > HEIGHT_MAX) return `身高 ${v}cm 超出常见范围（${HEIGHT_MIN}–${HEIGHT_MAX}cm）`
  return null
}

// 逐行评估：缺姓名 / 身高异常 / 重名（对现有名单 + 同批前面的行）。
// 同批重名只统计「参与导入」的行：取消勾选某行可解除后面行的重名。
export function assessRows(rows: AssessRow[], existingNames: string[]): RowProblem[][] {
  const existing = new Set(existingNames)
  const seen = new Map<string, number>() // 姓名 -> 首次出现的行号（仅参与导入的行）
  return rows.map((r) => {
    const problems: RowProblem[] = []
    const name = r.name.trim()
    if (!name) problems.push({ type: 'missing', message: '缺少姓名' })
    const hp = heightProblem(r.heightText)
    if (hp) problems.push({ type: 'height', message: hp })
    if (name) {
      if (existing.has(name)) problems.push({ type: 'duplicate', message: `与现有名单中的「${name}」重名` })
      if (r.include) {
        const first = seen.get(name)
        if (first !== undefined) problems.push({ type: 'duplicate', message: `与本次第 ${first} 行重名` })
        else seen.set(name, r.lineNo)
      }
    }
    return problems
  })
}

// 通过校验的行 → 学生实体
export function toStudent(row: { name: string; heightText: string; note: string }): Student {
  const h = row.heightText.trim()
  const note = row.note.trim()
  return {
    id: uid(),
    name: row.name.trim(),
    heightCm: h ? Number(h) : undefined,
    vision: 'none',
    mustApartFrom: [],
    note: note || undefined,
  }
}
