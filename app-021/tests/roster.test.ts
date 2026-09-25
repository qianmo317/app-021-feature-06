import { describe, expect, it } from 'vitest'
import { assessRows, heightProblem, parseRosterText, toStudent } from '../src/lib/roster'

// 批量粘贴名单：解析与逐行校验（对应「先预览再入库」的判定逻辑）

describe('parseRosterText', () => {
  it('支持逗号 / 中文逗号 / 顿号 / 分号 / 制表符分隔', () => {
    const rows = parseRosterText('张三,152,戴眼镜\n李四，148\n王五、150\n赵六;151\n钱七\t149\t爱说话')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ lineNo: 1, name: '张三', heightText: '152', note: '戴眼镜' })
    expect(rows[1]).toMatchObject({ name: '李四', heightText: '148', note: '' })
    expect(rows[2]).toMatchObject({ name: '王五', heightText: '150' })
    expect(rows[3]).toMatchObject({ name: '赵六', heightText: '151' })
    expect(rows[4]).toMatchObject({ name: '钱七', heightText: '149', note: '爱说话' })
  })

  it('空行与 \\r\\n 被忽略，行号按非空行排序', () => {
    const rows = parseRosterText('\r\n张三,152\r\n\r\n李四,148\n')
    expect(rows).toHaveLength(2)
    expect(rows[0].lineNo).toBe(1)
    expect(rows[1].lineNo).toBe(2)
  })

  it('超过 3 个字段时并入备注，不丢数据', () => {
    const [r] = parseRosterText('张三,152,戴眼镜,坐前排,周三值日')
    expect(r.note).toBe('戴眼镜，坐前排，周三值日')
  })

  it('字段为空时保留空位（如「,152」姓名缺失，交由校验标出）', () => {
    const [r] = parseRosterText(',152')
    expect(r.name).toBe('')
    expect(r.heightText).toBe('152')
  })
})

describe('heightProblem', () => {
  it('空身高合法（可选）', () => {
    expect(heightProblem('')).toBeNull()
    expect(heightProblem('  ')).toBeNull()
  })
  it('整数与小数合法', () => {
    expect(heightProblem('152')).toBeNull()
    expect(heightProblem('152.5')).toBeNull()
  })
  it('字母 / 汉字不是数字', () => {
    expect(heightProblem('abc')).toContain('不是数字')
    expect(heightProblem('一米五')).toContain('不是数字')
  })
  it('超出常见范围被标出', () => {
    expect(heightProblem('50')).toContain('超出常见范围')
    expect(heightProblem('250')).toContain('超出常见范围')
  })
})

describe('assessRows', () => {
  const row = (name: string, heightText = '', include = true, lineNo = 1) => ({
    name,
    heightText,
    include,
    lineNo,
  })

  it('正常行无问题', () => {
    expect(assessRows([row('张三', '150')], [])).toEqual([[]])
  })

  it('缺姓名与身高异常分别标出，且可叠加', () => {
    const [p] = assessRows([row('', 'abc')], [])
    expect(p.map((x) => x.type).sort()).toEqual(['height', 'missing'])
  })

  it('与现有名单重名', () => {
    const [p] = assessRows([row('张三')], ['张三'])
    expect(p).toHaveLength(1)
    expect(p[0].type).toBe('duplicate')
    expect(p[0].message).toContain('现有名单')
  })

  it('同批重名：首行通过，后续行标出并指向首行', () => {
    const ps = assessRows([row('张三', '', true, 1), row('张三', '', true, 2)], [])
    expect(ps[0]).toHaveLength(0)
    expect(ps[1]).toHaveLength(1)
    expect(ps[1][0].message).toContain('第 1 行')
  })

  it('取消勾选前面的行可解除后面行的同批重名', () => {
    const ps = assessRows([row('张三', '', false, 1), row('张三', '', true, 2)], [])
    expect(ps[1]).toHaveLength(0)
  })

  it('改名后（含加备注后缀）重名解除', () => {
    const ps = assessRows([row('张三（新转来）'), row('张三')], ['张三'])
    expect(ps[0]).toHaveLength(0)
    expect(ps[1][0].type).toBe('duplicate')
  })

  it('一行可同时命中「对现有名单」与「同批」两种重名', () => {
    const ps = assessRows([row('张三', '', true, 1), row('张三', '', true, 2)], ['张三'])
    expect(ps[1].filter((p) => p.type === 'duplicate')).toHaveLength(2)
  })
})

describe('toStudent', () => {
  it('生成合法学生实体（身高转数字、空备注转 undefined、姓名去空格）', () => {
    const s = toStudent({ name: ' 张三 ', heightText: '152', note: ' ' })
    expect(s.name).toBe('张三')
    expect(s.heightCm).toBe(152)
    expect(s.note).toBeUndefined()
    expect(s.vision).toBe('none')
    expect(s.mustApartFrom).toEqual([])
    expect(s.id).toBeTruthy()
  })

  it('身高留空则不填', () => {
    const s = toStudent({ name: '李四', heightText: '', note: '爱说话' })
    expect(s.heightCm).toBeUndefined()
    expect(s.note).toBe('爱说话')
  })
})
