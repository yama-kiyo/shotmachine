#!/usr/bin/env node
// ビルド成果物の秘密情報チェック（依存なし）。`npm run build` の最後に実行され、失敗するとビルドが落ちる。
//
//   node scripts/check-bundle.mjs [distDir]   (既定: dist)
//
// 失敗条件:
//   1. ビルド時に VITE_*KEY / VITE_*TOKEN / VITE_*SECRET が空でない値を持つ
//      （プロセス環境変数、および Vite が読む .env / .env.local / .env.production 等のファイル）
//   2. dist/ 配下のいずれかのファイルにキー形状の文字列が含まれる
//   3. dist/ 配下に、ビルド環境の秘密っぽい環境変数（名前に KEY/TOKEN/SECRET/PASSWORD）の値がそのまま含まれる
//
// 出力はファイル名・パターン名・件数のみ。一致した文字列そのものは絶対に表示しない。
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const distDir = resolve(root, process.argv[2] ?? 'dist')
const SECRET_ENV_NAME = /^VITE_.*(KEY|TOKEN|SECRET)$/i
const problems = []

// ---- 1. ビルド時の VITE_ 秘密変数 ----
for (const [name, value] of Object.entries(process.env)) {
  if (SECRET_ENV_NAME.test(name) && (value ?? '').trim() !== '') {
    problems.push(`環境変数 ${name} に値が設定されています（BYOK のため VITE_ のキーは設定しないこと）`)
  }
}
// Vite は process.env 以外に .env 系ファイルも読む。.env.example 以外の .env* を検査
const parseEnvFile = (text) => {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if (/^["']/.test(v)) v = v.slice(1, v.indexOf(v[0], 1) === -1 ? undefined : v.indexOf(v[0], 1))
    else v = v.replace(/\s+#.*$/, '')
    out.push([m[1], v.trim()])
  }
  return out
}
for (const f of readdirSync(root)) {
  if (!/^\.env(\..+)?$/.test(f) || f === '.env.example') continue
  let text
  try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
  for (const [name, v] of parseEnvFile(text)) {
    if (SECRET_ENV_NAME.test(name) && v !== '') {
      problems.push(`${f} の ${name} に値が設定されています（BYOK のため VITE_ のキーは設定しないこと）`)
    }
  }
}

// ---- 2. dist/ のキー形状文字列 ----
const PATTERNS = [
  ['anthropic-api-key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['elevenlabs-api-key (sk_...)', /sk_[A-Za-z0-9]{32,}/g],
  ['openai-style-key (sk-...)', /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
  ['xi-api-key literal header', /xi-api-key["'`]?\s*[:,=]\s*["'`][A-Za-z0-9_-]{20,}["'`]/gi],
  ['x-api-key literal header', /x-api-key["'`]?\s*[:,=]\s*["'`][A-Za-z0-9_-]{20,}["'`]/gi],
  ['authorization bearer literal', /["'`]Bearer\s+[A-Za-z0-9._~+/-]{24,}=*["'`]/g],
  ['stripe-secret-key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
]

// 本番ビルドに残ってはいけない E2E 用フック（main.tsx。--mode e2e のときだけ入る）
PATTERNS.push(['e2e-test-hook (__shotmachine_test__)', /__shotmachine_test__/g])

// ---- 3. ビルド環境の秘密値そのもの（define 等で焼き込まれた場合の検出） ----
const literalSecrets = Object.entries(process.env)
  .filter(([name, v]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && typeof v === 'string' && v.trim().length >= 16)
  .map(([name, v]) => [name, v.trim()])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (st.isFile()) out.push(p)
  }
  return out
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  problems.push(`${relative(root, distDir) || distDir} が見つかりません（先に vite build が必要）`)
} else {
  const files = walk(distDir)
  for (const file of files) {
    // latin1 で読む: どのバイト列でも例外にならず、ASCII のパターンはそのまま一致する
    const text = readFileSync(file, 'latin1')
    const rel = relative(root, file).replace(/\\/g, '/')
    for (const [label, re] of PATTERNS) {
      re.lastIndex = 0
      const n = (text.match(re) ?? []).length
      if (n > 0) problems.push(`${rel}: ${label} x${n}`)
    }
    for (const [name, value] of literalSecrets) {
      if (text.includes(value)) problems.push(`${rel}: 環境変数 ${name} の値が含まれています`)
    }
  }
  if (problems.length === 0) console.log(`[check-bundle] OK: ${files.length} ファイルを検査、秘密情報の混入なし`)
}

if (problems.length > 0) {
  console.error('[check-bundle] FAIL: 秘密情報の混入または混入リスクを検出しました')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
