import { expect, test, type Page } from '@playwright/test'
import { addStudent } from './helpers'

// 批量粘贴：先预览、逐行分类与就地修复、确认后才入库、结果页给出新增/跳过明细
// 本机 arm64 Chromium 在高负载下较慢，放宽单步动作超时
test.use({ actionTimeout: 30_000, navigationTimeout: 30_000 })
test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.getByTestId('new-class-name').fill('E2E 批量导入班')
  await page.getByTestId('create-class').click()
})

async function openBulk(page: Page, text: string) {
  await page.getByRole('button', { name: '批量粘贴' }).click()
  await page.getByTestId('bulk-text').fill(text)
  await expect(page.getByTestId('bulk-row').first()).toBeVisible()
}

function rowByLine(page: Page, line: number) {
  return page.locator(`[data-testid="bulk-row"][data-line="${line}"]`)
}

test('粘贴后逐行预览：正常 / 重名 / 缺字段 / 身高非数字 分类标注且写明原因，未确认前不入库', async ({ page }) => {
  // 现有名单里先放一个「张三」
  await addStudent(page, { name: '张三' })

  await openBulk(
    page,
    [
      '李四,148,爱说话', // 1 正常
      '张三,150', // 2 与现有名单重名
      '王五,151', // 3 正常
      '王五,149', // 4 与第 3 行重名
      ',150,没有姓名', // 5 缺姓名
      '赵六,abc', // 6 身高非数字
    ].join('\n'),
  )

  // 确认导入之前，班级里仍只有 1 人
  await expect(page.getByText('学生名单（1 人）')).toBeVisible()

  const summary = page.getByTestId('bulk-summary')
  await expect(summary).toContainText('共 6 行')
  await expect(summary).toContainText('可导入 2')
  await expect(summary).toContainText('重名 2')
  await expect(summary).toContainText('缺姓名 1')
  await expect(summary).toContainText('身高非数字 1')

  await expect(rowByLine(page, 1)).toHaveAttribute('data-status', 'ok')
  await expect(rowByLine(page, 2)).toHaveAttribute('data-status', 'duplicate')
  await expect(rowByLine(page, 2)).toContainText('与现有名单中的「张三」重名')
  await expect(rowByLine(page, 4)).toHaveAttribute('data-status', 'duplicate')
  await expect(rowByLine(page, 4)).toContainText('与第 3 行重名')
  await expect(rowByLine(page, 5)).toHaveAttribute('data-status', 'invalid')
  await expect(rowByLine(page, 5)).toContainText('缺少姓名')
  await expect(rowByLine(page, 6)).toHaveAttribute('data-status', 'invalid')
  await expect(rowByLine(page, 6)).toContainText('身高「abc」不是数字')

  // 确认按钮只导入可导入的 2 人
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 2 人')
})

test('重名就地改名、不合格行就地改好后全部导入；结果页给出新增与跳过明细', async ({ page }) => {
  await addStudent(page, { name: '张三' })
  await openBulk(
    page,
    [
      '李四,148', // 正常
      '张三,150,双胞胎之一', // 与现有重名 → 改名
      '王五,xyz', // 身高非数字 → 改身高
      '赵六', // 正常
    ].join('\n'),
  )

  // 第 2 行改名
  await rowByLine(page, 2).getByTestId('bulk-name').fill('张二')
  await expect(rowByLine(page, 2)).toHaveAttribute('data-status', 'ok')
  // 第 3 行把身高改好（原文 abc 仍在输入框里可直接改）
  await rowByLine(page, 3).getByTestId('bulk-height').fill('153')
  await expect(rowByLine(page, 3)).toHaveAttribute('data-status', 'ok')

  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 4 人')
  await page.getByTestId('bulk-add').click()

  // 结果页
  await expect(page.getByTestId('bulk-added-count')).toHaveText('4')
  await expect(page.getByTestId('bulk-skipped-count')).toHaveCount(0)

  // 入库后名单人数 = 1（张三）+ 4
  await page.getByTestId('bulk-done').click()
  await expect(page.getByText('学生名单（5 人）')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="张二"]')).toBeVisible()
})

test('不改直接导入：只进合格行，结果页列出跳过的行与原因，回去改后可再次导入', async ({ page }) => {
  await addStudent(page, { name: '张三' })
  await openBulk(
    page,
    [
      '李四,148,爱说话', // 导入
      '张三,150', // 跳过：重名
      '赵六,abc', // 跳过：身高非数字
      ',150', // 跳过：缺姓名
    ].join('\n'),
  )

  await page.getByTestId('bulk-add').click()
  await expect(page.getByTestId('bulk-added-count')).toHaveText('1')
  await expect(page.getByTestId('bulk-skipped-count')).toHaveText('3')
  const skipped = page.getByTestId('bulk-skipped-row')
  await expect(skipped).toHaveCount(3)
  await expect(skipped.nth(0)).toContainText('与现有名单中的「张三」重名')
  await expect(skipped.nth(1)).toContainText('身高「abc」不是数字')
  await expect(skipped.nth(2)).toContainText('缺少姓名')

  // 名单只多了李四
  await page.getByTestId('bulk-done').click()
  await expect(page.getByText('学生名单（2 人）')).toBeVisible()
})

test('结果页「回去改」把跳过行带回编辑：改好后再次导入', async ({ page }) => {
  await addStudent(page, { name: '张三' })
  await openBulk(page, ['李四,148', '张三,150', '赵六,abc'].join('\n'))

  await page.getByTestId('bulk-add').click()
  await expect(page.getByTestId('bulk-added-count')).toHaveText('1')
  await expect(page.getByTestId('bulk-skipped-count')).toHaveText('2')

  // 回到编辑阶段，只剩 2 行问题行；此时李四已进「现有名单」
  await page.getByTestId('bulk-resume').click()
  await expect(page.getByTestId('bulk-resume-hint')).toBeVisible()
  await expect(page.getByTestId('bulk-row')).toHaveCount(2)

  // 重名行改名（改好后因「只看有问题的行」过滤开启会立即移出列表，故按行号定位）
  await rowByLine(page, 2).getByTestId('bulk-name').fill('张二')
  await rowByLine(page, 3).getByTestId('bulk-height').fill('153')
  await expect(page.getByTestId('bulk-row')).toHaveCount(0)
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 2 人')
  await page.getByTestId('bulk-add').click()

  await expect(page.getByTestId('bulk-added-count')).toHaveText('2')
  await expect(page.getByTestId('bulk-skipped-count')).toHaveCount(0)
  await page.getByTestId('bulk-done').click()
  await expect(page.getByText('学生名单（4 人）')).toBeVisible()
})

test('字段超过 3 列：多出内容并入备注并提示核对，行仍可导入', async ({ page }) => {
  await openBulk(page, '李四,148,前排,爱说话,戴眼镜')
  await expect(rowByLine(page, 1)).toHaveAttribute('data-status', 'warning')
  await expect(rowByLine(page, 1)).toContainText('字段超过 3 列')
  await expect(rowByLine(page, 1).getByTestId('bulk-note')).toHaveValue('前排，爱说话，戴眼镜')
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 1 人')
})

test('「只看有问题的行」过滤；移除某行后不计入导入', async ({ page }) => {
  await openBulk(page, '李四,148\n赵六,abc\n王五,150')
  await page.getByText('只看有问题的行').click()
  await expect(page.getByTestId('bulk-row')).toHaveCount(1)
  // 把唯一的问题行删掉
  await page.getByTestId('bulk-row').locator('.icon-btn').click()
  await page.getByText('只看有问题的行').click()
  await expect(page.getByTestId('bulk-row')).toHaveCount(2)
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 2 人')
})
