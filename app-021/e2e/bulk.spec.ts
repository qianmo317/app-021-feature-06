import { expect, test, type Page } from '@playwright/test'
import { addStudent } from './helpers'

// 批量粘贴：先预览 → 就地修正 → 确认导入 → 结果明细（确认前不写入班级）

function row(page: Page, n: number) {
  return page.locator(`[data-testid="bulk-row"][data-line="${n}"]`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-class-name').fill('E2E 批量班')
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E 批量班 · 配置')
})

test('预览分行标出问题，就地修正后导入，结果给出新增/跳过明细', async ({ page }) => {
  await addStudent(page, { name: '张三', height: '150' })

  await page.getByRole('button', { name: '批量粘贴' }).click()
  await page
    .getByTestId('bulk-text')
    .fill(['张三,151', '李四,abc', ',160', '王五,152,爱说话', '钱七,149'].join('\n'))

  // 逐行标出：重名 / 身高不是数字 / 缺姓名 / 正常
  await expect(page.getByTestId('bulk-row')).toHaveCount(5)
  await expect(row(page, 1)).toContainText('需修正')
  await expect(row(page, 1)).toContainText('与现有名单中的「张三」重名')
  await expect(row(page, 2)).toContainText('身高「abc」不是数字')
  await expect(row(page, 3)).toContainText('缺少姓名')
  await expect(row(page, 4)).toContainText('可导入')
  await expect(row(page, 5)).toContainText('可导入')

  // 汇总与确认按钮如实反映
  await expect(page.getByTestId('bulk-summary')).toContainText('可导入 2 行')
  await expect(page.getByTestId('bulk-summary')).toContainText('需修正 3 行（重名 1 · 缺姓名 1 · 身高异常 1）')
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 2 人')

  // 确认导入前不写入班级
  await expect(page.getByText('学生名单（1 人）')).toBeVisible()

  // 就地修正：身高改数字、补上姓名、重名用备注区分
  await row(page, 2).getByTestId('row-height').fill('150')
  await expect(row(page, 2)).toContainText('可导入')
  await row(page, 3).getByTestId('row-name').fill('赵六')
  await expect(row(page, 3)).toContainText('可导入')
  await row(page, 1).getByTestId('row-note').fill('新转来')
  await row(page, 1).getByTestId('row-distinguish').click()
  await expect(row(page, 1).getByTestId('row-name')).toHaveValue('张三（新转来）')
  await expect(row(page, 1)).toContainText('可导入')

  // 手动取消勾选第 5 行 → 跳过
  await row(page, 5).getByTestId('row-include').uncheck()
  await expect(row(page, 5)).toContainText('跳过')
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 4 人')

  // 确认导入 → 结果明细：新增 4 人、跳过 1 行（钱七）
  await page.getByTestId('bulk-add').click()
  await expect(page.getByTestId('bulk-result')).toContainText('已新增 4 人，跳过 1 行')
  await expect(page.getByTestId('bulk-skipped')).toContainText('第 5 行')
  await expect(page.getByTestId('bulk-skipped')).toContainText('钱七')
  await expect(page.getByTestId('bulk-skipped')).toContainText('已取消勾选')

  await page.getByTestId('bulk-done').click()
  await expect(page.getByText('学生名单（5 人）')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="张三（新转来）"]')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="李四"]')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="赵六"]')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="王五"]')).toBeVisible()
  await expect(page.locator('[data-testid="student-row"][data-name="钱七"]')).toBeHidden()
})

test('同批粘贴内的重名标出并指向先出现的行，取消勾选可解除', async ({ page }) => {
  await page.getByRole('button', { name: '批量粘贴' }).click()
  await page.getByTestId('bulk-text').fill('孙八,150\n孙八,151')

  await expect(row(page, 1)).toContainText('可导入')
  await expect(row(page, 2)).toContainText('需修正')
  await expect(row(page, 2)).toContainText('与本次第 1 行重名')
  // 有问题的行不能强制勾选导入
  await expect(row(page, 2).getByTestId('row-include')).toBeDisabled()

  // 取消勾选第 1 行 → 第 2 行重名解除
  await row(page, 1).getByTestId('row-include').uncheck()
  await expect(row(page, 2)).toContainText('可导入')
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 1 人')

  await page.getByTestId('bulk-add').click()
  await expect(page.getByTestId('bulk-result')).toContainText('已新增 1 人，跳过 1 行')
  await expect(page.getByTestId('bulk-skipped')).toContainText('第 1 行')
  await page.getByTestId('bulk-done').click()
  await expect(page.getByText('学生名单（1 人）')).toBeVisible()
})

test('全部行都有问题时无法确认导入，且不会写入任何数据', async ({ page }) => {
  await addStudent(page, { name: '张三' })
  await page.getByRole('button', { name: '批量粘贴' }).click()
  await page.getByTestId('bulk-text').fill('张三,151\n,abc')
  await expect(page.getByTestId('bulk-add')).toBeDisabled()
  await expect(page.getByTestId('bulk-add')).toHaveText('确认导入 0 人')
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByText('学生名单（1 人）')).toBeVisible()
})
