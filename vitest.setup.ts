// テストランナーのタイムゾーンをJSTに固定する。
// 時間割・締切ロジックはブラウザのローカル時刻(=日本のユーザーはJST)を前提に
// getDay/getMonth/getDate を使うため、非JSTランナーで曜日・日付判定がぶれないよう固定する。
process.env.TZ = 'Asia/Tokyo'
