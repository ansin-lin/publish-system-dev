import { test, expect } from '@playwright/test';

test.use({
  storageState: 'C:\\Users\\compu\\.openclaw\\publish-system\\data\\auth\\facebook\\default\\state.json'
});

test('test', async ({ page }) => {
  await page.goto('https://www.facebook.com/');
  await page.getByRole('link', { name: '王 艶艶', exact: true }).click();
  await page.locator('.x9f619.x1ja2u2z.x78zum5.x2lah0s.x1n2onr6.xl56j7k.x1qjc9v5.xozqiw3.x1q0g3np.x1l90r2v').click();
  await page.goto('https://www.facebook.com/');
  await page.getByRole('link', { name: '王 艶艶', exact: true }).click();
  await page.getByRole('button', { name: 'その気持ち、シェアしよう' }).click();
  await page.getByRole('paragraph').click();
  await page.getByRole('textbox').fill('asd​');
  await page.getByRole('button', { name: '写真・動画' }).click();
  await page.getByRole('button', { name: '写真・動画' }).setInputFiles(['custom_96d40069a4f89204_img_1.png', 'custom_96d40069a4f89204_img_2.png', 'custom_96d40069a4f89204_img_3.png', 'custom_96d40069a4f89204_img_4.png']);
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: '投稿の共有範囲 友達' }).click();
  await page.getByText('Facebook利用者以外を含むすべての人').click();
  await page.getByRole('radio', { name: '友達 Facebookの友達' }).check();
  await page.getByRole('radio', { name: '公開 Facebook利用者以外を含むすべての人' }).check();
  await page.getByRole('button', { name: 'プライバシー設定の共有範囲の選択を完了して、ダイアログを閉じる' }).click();
  await page.getByRole('button', { name: '投稿', exact: true }).click();
});