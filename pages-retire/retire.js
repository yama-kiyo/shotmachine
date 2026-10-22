// 旧 GitHub Pages 版の退役ページ。
// yama-kiyo.github.io は同一ユーザーの全 Pages サイトで同じオリジン（localStorage 共有）のため、
// ショットマシンが保存したキーだけを個別に削除する（localStorage.clear() はしない）。
// 移転先 URL は公開前に PM が確定させること（index.html の a#new-url と NEW_URL の両方）。
const NEW_URL = 'https://shotmachine.vercel.app/'
const KEYS = ['shotmachine.apiKey', 'shotmachine.elevenLabsKey']

let removed = 0
try {
  for (const k of KEYS) {
    if (localStorage.getItem(k) !== null) removed++
    localStorage.removeItem(k)
  }
} catch {
  // ストレージが使えない環境（プライベートモード等）では何もしない
}

document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status')
  if (status) {
    status.textContent = removed > 0
      ? `保存されていたキー ${removed} 件を削除しました / Removed ${removed} saved key(s).`
      : '削除対象のキーはありませんでした / No saved keys were found.'
  }
  setTimeout(() => location.replace(NEW_URL), 5000)
})
