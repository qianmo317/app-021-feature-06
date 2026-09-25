import { describe, expect, it } from 'vitest'
import { bulkSummary, evaluateBulkRows, parseBulkText, toStudents } from '../src/lib/bulk'

function roundtrip(text: string, existing: string[] = []) {
  return evaluateBulkRows(parseBulkText(text), existing)
}

describe('parseBulkText', () => {
  it('空行被跳过，非空行全部保留（含无姓名、非数字身高）', () => {
    const rows = parseBulkText('\n张三,152\n\n  \n,150,无名氏\n赵六,abc\n')
    expect(rows.map((r) => r.lineNo)).toEqual([2, 5, 6])
    expect(rows[0]).toMatchObject({ name: '张三', heightText: '152', note: '' })
    expect(rows[1]).toMatchObject({ name: '', heightText: '150', note: '无名氏' })
    expect(rows[2]).toMatchObject({ name: '赵六', heightText: 'abc' })
  })

  it('支持中文逗号与制表符', () => {
    const rows = parseBulkText('张三，152，戴眼镜\n李四\t148\t前排')
    expect(rows[0]).toMatchObject({ name: '张三', heightText: '152', note: '戴眼镜' })
    expect(rows[1]).toMatchObject({ name: '李四', heightText: '148', note: '前排' })
  })

  it('字段超过 3 列时多余内容并入备注并标记 extra，不再静默丢失', () => {
    const rows = parseBulkText('张三,152,备注一,备注二,备注三')
    expect(rows[0]).toMatchObject({ name: '张三', heightText: '152', note: '备注一，备注二，备注三', extra: true })
  })

  it('CRLF 换行正常解析', () => {
    expect(parseBulkText('张三,152\r\n李四')).toHaveLength(2)
  })
})

describe('evaluateBulkRows', () => {
  it('正常行可导入，小数身高也接受', () => {
    const rows = roundtrip('张三,152\n李四,148.5,爱说话\n王五')
    expect(rows.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(rows.map((r) => r.importable)).toEqual([true, true, true])
    expect(rows[0].heightCm).toBe(152)
    expect(rows[1].heightCm).toBe(148.5)
    expect(rows[2].heightCm).toBeUndefined()
  })

  it('缺姓名 → invalid，写明原因', () => {
    const rows = roundtrip(',150,无名氏')
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].importable).toBe(false)
    expect(rows[0].issues.map((i) => i.kind)).toContain('missing_name')
  })

  it('身高不是数字 → invalid，原文保留可改', () => {
    const rows = roundtrip('赵六,abc')
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].heightText).toBe('abc')
    expect(rows[0].issues.map((i) => i.kind)).toContain('bad_height')
  })

  it('与现有名单重名：全部标出，仅第一次出现可导入，原因区分对象', () => {
    const rows = roundtrip('张三,150\n张三,151\n李四', ['张三'])
    expect(rows[0].status).toBe('duplicate')
    expect(rows[0].importable).toBe(false)
    expect(rows[0].issues[0].text).toContain('现有名单')
    expect(rows[1].status).toBe('duplicate')
    expect(rows[1].importable).toBe(false)
    expect(rows[1].issues[0].text).toContain('第 1 行重名')
    expect(rows[2].status).toBe('ok')
  })

  it('粘贴内重名：第一个可导入，第二个不可', () => {
    const rows = roundtrip('张三\n张三')
    expect(rows[0].importable).toBe(true)
    expect(rows[1].importable).toBe(false)
    expect(rows[1].issues[0].text).toContain('第 1 行')
  })

  it('字段过多为 warning：行仍可导入', () => {
    const rows = roundtrip('张三,152,备注一,备注二')
    expect(rows[0].status).toBe('warning')
    expect(rows[0].importable).toBe(true)
    // 用户就地编辑后不再提示字段过多
    const fixed = evaluateBulkRows([{ ...rows[0], edited: true }], [])
    expect(fixed[0].status).toBe('ok')
    expect(fixed[0].issues).toHaveLength(0)
  })

  it('就地改好不合格行后可导入（非数字身高改成数字）', () => {
    const rows = roundtrip('赵六,abc')
    const fixed = evaluateBulkRows([{ ...rows[0], heightText: '160', edited: true }], [])
    expect(fixed[0].status).toBe('ok')
    expect(fixed[0].heightCm).toBe(160)
    expect(fixed[0].importable).toBe(true)
  })

  it('就地改名后重名消除', () => {
    const rows = roundtrip('张三\n李四', ['张三'])
    const fixed = evaluateBulkRows([{ ...rows[0], name: '张三峰', edited: true }, rows[1]], ['张三'])
    expect(fixed[0].status).toBe('ok')
  })

  it('统计汇总正确', () => {
    const rows = roundtrip('张三,152\n张三,151\n,150\n赵六,abc\n钱七,140,备注,多', ['张三'])
    const s = bulkSummary(rows)
    expect(s.total).toBe(5)
    // 两行张三都与现有名单重名；缺名、身高非数字各一行；钱七字段过多但仍可导入
    expect(s.importable).toBe(1)
    expect(s.ok).toBe(0)
    expect(s.duplicate).toBe(2)
    expect(s.missingName).toBe(1)
    expect(s.badHeight).toBe(1)
    expect(s.extraFields).toBe(1)
  })
})

describe('toStudents', () => {
  it('只输出可导入行，带 uid 与默认字段；空备注为 undefined', () => {
    const rows = roundtrip('张三,152\n赵六,abc\n李四,,爱说话')
    const students = toStudents(rows)
    expect(students).toHaveLength(2)
    expect(students[0]).toMatchObject({ name: '张三', heightCm: 152, vision: 'none', mustApartFrom: [] })
    expect(students[0].id).toBeTruthy()
    expect(students[1]).toMatchObject({ name: '李四', heightCm: undefined, note: '爱说话' })
  })

  it('全部不合格时输出空数组', () => {
    expect(toStudents(roundtrip(',150\n赵六,abc'))).toEqual([])
  })
})
