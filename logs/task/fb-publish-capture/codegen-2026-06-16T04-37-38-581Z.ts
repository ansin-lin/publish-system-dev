import { test, expect } from '@playwright/test';

test.use({
  storageState: 'C:\\Users\\compu\\.openclaw\\publish-system\\data\\auth\\facebook\\default\\state.json'
});

test('test', async ({ page }) => {
  await page.goto('https://www.facebook.com/');
  await page.getByRole('button', { name: '王 艶艶さん、その気持ち、シェアしよう' }).click();
  await page.getByRole('paragraph').click();
  await page.getByRole('textbox').fill('123456');
  await page.getByRole('button', { name: '写真または動画を追加 またはドラッグ＆ドロップ' }).click();
  await page.getByRole('button', { name: '写真または動画を追加 またはドラッグ＆ドロップ' }).setInputFiles(['custom_96d40069a4f89204_img_1.png', 'custom_96d40069a4f89204_img_2.png', 'custom_96d40069a4f89204_img_3.png', 'custom_96d40069a4f89204_img_4.png']);
  await page.getByRole('button', { name: '投稿の共有範囲 友達' }).click();
  await page.getByRole('radio', { name: '公開 Facebook利用者以外を含むすべての人' }).check();
  await page.getByText('公開', { exact: true }).click();
  await page.getByRole('button', { name: 'プライバシー設定の共有範囲の選択を完了して、ダイアログを閉じる' }).click();
  await page.getByRole('button', { name: '投稿', exact: true }).click();
});