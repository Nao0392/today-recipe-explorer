# 共通レシピデータの運用

## 正式なデータソース
- `data/delish_teiban_photo.json` が現在のアプリで使う唯一の標準データファイルです。
- `data-adapter.js` の `RecipeData.load()` から読み込みます。
- `index.html` / `search.html` / `atlas.html` / `atlas-discovery.html` は同じローダーを使用します。
- 件数は実データの `recipes.length` で表示してください。184などの固定値を記述しません。

## 以前のデータファイル
- `recipes.json` は従来の30件サンプルで、一部の既存テストに使われています。
- `data/delish_teiba_photo.json` および `data/delish_teiban.json` などは履歴・収集・処理用であり、現行画面には直接接続しません。
- 内容が重複する別データを、IDや名称の正規化なしで単純連結しないでください。
- 既存ファイルは他のチームメンバーが参照している可能性があるため削除しません。

## レシピを更新するとき
1. 標準JSONの `recipes` 配列、`ingredients` 辞書、レシピID、食材名、画像パスを検証する。
2. 推定値、欠損値を区別する（未確認の数値を0として確定しない）。
3. `node tests/data-source.test.js` と既存テストを実行する。
4. Live Serverで4画面を開き、表示件数・代表レシピ・おすすめ結果を確認する。
5. `atlas-discovery.html` の「JSONファイル選択」は一時的なプレビュー用です。ファイル選択は他のページの共通データを変更しません。

## 注意
料理の特徴による類似度は利用者の好みと一致する確率ではありません。
