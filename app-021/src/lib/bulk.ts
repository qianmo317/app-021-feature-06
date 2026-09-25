import type { Student } from '../types'
import { uid } from './id'

// ================= 批量粘贴名单：解析 → 逐行评定 → 入库前可编辑预览 =================
// 纯函数，不碰 UI，方便单测（旧实现把非数字身高、字段缺失的行悄悄丢弃，只能在这里修）

export type BulkIssueKind = 'missing_name' | 'bad_height' | 'duplicate' | 'extra_fields'

/** 解析阶段：文本 → 可编辑草稿行（不做合格性判断，也不丢任何字段） */
export interface BulkDraftRow {
  lineNo: number // 在粘贴文本中的物理行号（1 起，空行不参与解析但占位号）
  name: string
  heightText: string // 身高保留原始文本，「abc」也要能在预览里改
  note: string
  extra: boolean // 解析时字段超过 3 列
  edited: boolean // 用户是否就地改过（改过就不再提示「字段过多」）
}

export type BulkStatus = 'ok' | 'warning' | 'duplicate' | 'invalid'

export interface BulkIssue {
  kind: BulkIssueKind
  text: string
}

/** 评定阶段：每行带状态、原因、能否导入 */
export interface BulkEvaluatedRow extends BulkDraftRow {
  status: BulkStatus
  issues: BulkIssue[]
  heightCm?: number
  importable: boolean
}

export interface BulkSummary {
  total: number
  ok: number
  importable: number
  missingName: number
  badHeight: number
  duplicate: number
  extraFields: number
}

const NUM_RE = /^\d+(\.\d+)?$/
// 半角逗号、中文逗号、制表符（从 Excel / WPS 粘贴）
const SEP_RE = /[,，\t]/

/** 把粘贴文本解析成草稿行。空行跳过；任何非空行都保留，绝不静默丢弃 */
export function parseBulkText(text: string): BulkDraftRow[] {
  const rows: BulkDraftRow[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const parts = line.split(SEP_RE).map((s) => s.trim())
    const [name = '', heightText = '', note = '', ...rest] = parts
    // 第 4 列起不再丢失：并入备注，由用户核对（warning，不阻断导入）
    const mergedNote = [note, ...rest].filter(Boolean).join('，')
    rows.push({
      lineNo: i + 1,
      name,
      heightText,
      note: mergedNote,
      extra: parts.length > 3,
      edited: false,
    })
  })
  return rows
}

/**
 * 逐行评定。重名同时与「现有名单」和「本次粘贴内更早的行」比对：
 * 所有重名行都会标出，只有第一次出现的那行可导入，其余就地改名后即可导入。
 */
export function evaluateBulkRows(rows: BulkDraftRow[], existingNames: string[]): BulkEvaluatedRow[] {
  const existing = new Set(existingNames)
  const seen = new Map<string, number>() // 本次粘贴中每个姓名第一次出现的行号
  return rows.map((row) => {
    const issues: BulkIssue[] = []
    const name = row.name.trim()
    const h = row.heightText.trim()

    if (!name) {
      issues.push({ kind: 'missing_name', text: '缺少姓名：第 1 列必须是姓名' })
    }
    if (h && !NUM_RE.test(h)) {
      issues.push({ kind: 'bad_height', text: `身高「${h}」不是数字，请填厘米数（如 152）或清空` })
    }
    if (name) {
      const firstAt = seen.get(name)
      if (firstAt !== undefined) {
        // 同时撞现有名单与本次行时，优先指出本次的上一行，形成可追踪的链条
        issues.push({
          kind: 'duplicate',
          text: `与第 ${firstAt} 行重名：姓名必须唯一，请改名（可在备注里注明区分信息）`,
        })
      } else if (existing.has(name)) {
        issues.push({ kind: 'duplicate', text: `与现有名单中的「${name}」重名：姓名必须唯一，请改名（可在备注里注明区分信息）` })
      }
      seen.set(name, firstAt ?? row.lineNo)
    }
    if (row.extra && !row.edited) {
      issues.push({ kind: 'extra_fields', text: '字段超过 3 列（姓名,身高,备注），多出的内容已并入备注，请核对' })
    }

    const invalidKinds: BulkIssueKind[] = ['missing_name', 'bad_height']
    let status: BulkStatus = 'ok'
    if (issues.some((x) => invalidKinds.includes(x.kind))) status = 'invalid'
    else if (issues.some((x) => x.kind === 'duplicate')) status = 'duplicate'
    else if (issues.some((x) => x.kind === 'extra_fields')) status = 'warning'

    return {
      ...row,
      name,
      heightText: h,
      status,
      issues,
      heightCm: h && NUM_RE.test(h) ? Number(h) : undefined,
      importable: status === 'ok' || status === 'warning',
    }
  })
}

export function bulkSummary(rows: BulkEvaluatedRow[]): BulkSummary {
  const s: BulkSummary = {
    total: rows.length,
    ok: 0,
    importable: 0,
    missingName: 0,
    badHeight: 0,
    duplicate: 0,
    extraFields: 0,
  }
  for (const r of rows) {
    if (r.status === 'ok') s.ok++
    if (r.importable) s.importable++
    const kinds = new Set(r.issues.map((i) => i.kind))
    if (kinds.has('missing_name')) s.missingName++
    if (kinds.has('bad_height')) s.badHeight++
    if (kinds.has('duplicate')) s.duplicate++
    if (kinds.has('extra_fields')) s.extraFields++
  }
  return s
}

/** 只把可导入行变成 Student（弹窗里点「确认导入」之前不会调用） */
export function toStudents(rows: BulkEvaluatedRow[]): Student[] {
  return rows
    .filter((r) => r.importable)
    .map((r) => ({
      id: uid(),
      name: r.name.trim(),
      heightCm: r.heightCm,
      vision: 'none',
      mustApartFrom: [],
      note: r.note.trim() || undefined,
    }))
}
