import { describe, it, expect } from 'vitest'
import { emotionToArmPose } from '../emotionToArmPose'

describe('emotionToArmPose（感情注記→腕ポーズ）', () => {
  it('怒り系 → 腰に手', () => {
    expect(emotionToArmPose('怒り')).toBe('hands_on_hips')
    expect(emotionToArmPose('激怒')).toBe('hands_on_hips')
    expect(emotionToArmPose('苛立ち')).toBe('hands_on_hips')
  })

  it('困惑・不安・疑い系 → 腕組み', () => {
    expect(emotionToArmPose('困惑')).toBe('crossed')
    expect(emotionToArmPose('不安')).toBe('crossed')
    expect(emotionToArmPose('疑い')).toBe('crossed')
  })

  it('喜び・挨拶系 → 手を振る', () => {
    expect(emotionToArmPose('喜び')).toBe('wave')
    expect(emotionToArmPose('挨拶')).toBe('wave')
  })

  it('強調・指示系 → 指差し', () => {
    expect(emotionToArmPose('強調')).toBe('point')
    expect(emotionToArmPose('指示')).toBe('point')
  })

  it('未指定（undefined / null） → natural', () => {
    expect(emotionToArmPose(undefined)).toBe('natural')
    expect(emotionToArmPose(null)).toBe('natural')
  })

  it('空文字・空白のみ → natural', () => {
    expect(emotionToArmPose('')).toBe('natural')
    expect(emotionToArmPose('　 ')).toBe('natural')
  })

  it('未知語・平静 → natural（フォールバック）', () => {
    expect(emotionToArmPose('平静')).toBe('natural')
    expect(emotionToArmPose('眠そう')).toBe('natural')
  })

  it('tpose は自動割当しない（どの感情でも返らない）', () => {
    const samples = ['怒り', '困惑', '喜び', '強調', '平静', '', 'なにか']
    for (const s of samples) expect(emotionToArmPose(s)).not.toBe('tpose')
  })

  it('部分一致でも拾う（文中にキーワード）', () => {
    expect(emotionToArmPose('少し怒っている')).toBe('hands_on_hips')
    expect(emotionToArmPose('やや不安げ')).toBe('crossed')
  })

  it('前後の空白を無視する', () => {
    expect(emotionToArmPose('  喜び  ')).toBe('wave')
  })

  it('評価順: 先頭ルール（怒り）が優先される', () => {
    // 怒りと困惑の両キーワードを含む場合、配列先頭の怒り判定が勝つ
    expect(emotionToArmPose('怒りと困惑')).toBe('hands_on_hips')
  })

  it('戻り値は必ず ArmPose の6値のいずれか', () => {
    const valid = new Set(['natural', 'hands_on_hips', 'crossed', 'wave', 'point', 'tpose'])
    const inputs = ['怒り', '困惑', '喜び', '強調', '謎', undefined, '']
    for (const i of inputs) expect(valid.has(emotionToArmPose(i))).toBe(true)
  })
})
