# スマホ専用画面

PC版を変更せず、各画面をスマホ向けに表示する入口です。

- `index.html`：トップページ
- `search.html`：食材・条件による料理検索
- `favorites.html`：お気に入り
- `map.html`：類似度マップ

既存ページの構造・データ・検索スクリプトを読み込み、`mobile.css` でスマホ向けのレイアウトを適用します。検索画面では、条件を下から開くパネルと詳細の下部シートを使います。

Live Server で、`mobile/index.html` を開いて確認してください。

## PWAとして使う

`manifest.webmanifest` と `service-worker.js` を含むため、HTTPSで公開したスマホ版はホーム画面へ追加できます。開発中は Live Server の `localhost` でも確認できます。

- Android Chrome: メニューから「アプリをインストール」または「ホーム画面に追加」
- iPhone Safari: 共有ボタンから「ホーム画面に追加」

レシピ画像は、表示したものだけを最大80枚まで端末にキャッシュします。料理データJSONも、一度読み込んだ後は通信失敗時にキャッシュを利用します。
