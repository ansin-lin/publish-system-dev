import { test, expect } from '@playwright/test';

test.use({
  storageState: 'C:\\Users\\compu\\.openclaw\\publish-system\\data\\auth\\xiaohongshu\\default\\state.json'
});

test('test', async ({ page }) => {
  await page.goto('https://creator.xiaohongshu.com/publish/publish?from=menu');
  await page.getByText('上传图文').nth(2).click();
  await page.getByRole('button', { name: '上传图片' }).click();
  await page.getByRole('button', { name: '上传图片' }).setInputFiles(['custom_1c37da1206196461_img_1.png', 'custom_1c37da1206196461_img_2.png', 'custom_1c37da1206196461_img_3.png', 'custom_1c37da1206196461_img_4.png']);
  await page.getByRole('textbox', { name: '填写标题会有更多赞哦' }).click();
  await page.getByRole('textbox', { name: '填写标题会有更多赞哦' }).fill('test');
  await page.getByRole('paragraph').click();
  await page.getByRole('textbox').nth(1).fill('test');
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
  await page.locator('xhs-publish-btn').click();
});