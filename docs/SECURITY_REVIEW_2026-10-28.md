# セキュリティ確認・修正（2026-10-28）

## 対象と判断

[依頼元のTreasure AIセキュリティ更新](https://www.treasure.ai/blog/security-update-php-nodejs-emudhra-pingcap-tidb)と、このリポジトリのソース・依存ロック・GitHub Pages用CIを照合した。TD接続、実データ取得、公開サイトの攻撃的な検証は行っていない。

このアプリはReact/Viteの静的サイトであり、PHP、Tomcat、TiDBのサーバー実装やコンテナは含まない。PHPのCVE-2026-109618 / CVE-2026-109619に対する、このリポジトリでのパッチ対象は見つからなかった。eMudhraの証明書信頼設定もこのリポジトリにはない。これらが別途ホスト環境に存在しないことまで保証するものではない。

## 修正した依存関係と実行環境

| 対象 | 修正 | 根拠・適用範囲 |
| --- | --- | --- |
| Node.js | `engines`・`.npmrc`・CLIで24.22.1以上の24系、または26.12.1以上の26系を要求。CIは最新24系を選ぶ | [公式October 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。今回の検証環境は24.22.1。Node自体を配布するプロジェクトではないので、利用者の外部環境へのパッチ配布ではなく修正版の利用を強制する |
| Vite | ロックを8.2.2から8.3.5へ更新、宣言上の下限を8.2.4に更新 | CVE-2026-112945 / 112946 / 112947、およびlaunch-editor関連CVE-2026-112942 / 112943 / 112944。主に開発サーバー条件の問題であり、Pages上の静的ファイルがViteサーバーを公開するわけではない |
| source-map-js | 1.2.1から1.2.2へ更新 | [GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。ビルド時のsource map処理も確認対象とした |
| jspdf / DOMPurify | 未使用のjspdf依存を削除し、該当DOMPurifyを依存ツリーから除去 | [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7)、[GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)。脆弱なバージョンがロックにあったが、このアプリが問題のAPIを呼んでいたと断定していない |
| Vitest / mocker / npm undici | テストはnode:testを使用しているため未使用のVitestを削除。該当する間接依存も除去 | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)、[GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)、[GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)。Node内蔵のHTTP実装の対策とは別である |
| yaml | ソースで未使用の直接依存を削除 | 依存面の縮小。使用中のhtml-to-imageによるPNG出力は維持 |
| GitHub Actions | checkout v7.0.1、setup-node v7.1.0、upload-pages-artifact v5.0.0、deploy-pages v5.0.1へ更新 | 公式リリースのNode 24対応版。setup-nodeで指定するアプリのNodeと、各Action自体のランタイムは別である |

Viteの一次情報: [GHSA-9jrq-w75r-8gcw](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)、[GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)、[GHSA-vfpm-58rq-9qcg](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg)。依存ロックも再作成し、以前のロックで不足していたoxlintの他OS向けoptional bindingの整合性を修正した。

## サンプル実データの廃止

- 生データだけでなく、マスク・ハッシュ化・部分伏字の行サンプルも取得しない。
- 行取得SQLの生成、結果取り込み、Webの行サンプルタブ・カバレッジ・ID実例を削除。SQLのクエリ例はテキストとして維持する。
- CLIは非nullの`samples` / `example_masked`、非0の`sample_rows_max`を全JSON（過去のスナップショットと追加JSONを含む）で拒否する。release / pack / skillは検証エラーを無視できず、`--force`でも回避できない。unpackは書き込み前に旧サンプルを拒否する。
- ビューアーは旧カタログを読み込んでも、旧サンプルフィールドを現在の状態・過去の状態から除去する。ブラウザーのセッションには正規化したメタデータだけを再構成して保存し、旧キャッシュも読み直し時に置き換える。
- 同梱デモ・デモ生成スクリプト・ZIP・スキル・プロンプトも更新した。デモは架空のメタデータであり、行サンプルは含まない。

旧ZIP自体のバイト列、すでに配布済みの旧SKILL、Git履歴、他の端末のキャッシュが自動的に消えるわけではない。説明・SQL・MEMORY.mdなどの自由記述に転記済みの実データを、フィールド検査だけですべて検出できる保証もない。元の取得を禁止し、配布前に内容を確認することが前提となる。

## ZIPとローカルファイルの対策

CLIとブラウザーで、絶対パス、`..`、バックスラッシュ、Windowsドライブ・ADS・特殊名、大小文字を含む重複パス、リンクエントリを拒否する。ローカルヘッダーと中央ディレクトリの名前・方式・範囲、展開サイズ、CRCも検査する。

上限は入力25MiB、1エントリ10MiB、展開合計100MiB、5,000エントリ。CLIはzlibの実出力上限、ブラウザーは小さい圧縮チャンクを使うストリーミング展開で、虚偽の宣言サイズにも上限を適用する。暗号化ZIP・分割ZIP・ZIP64は未対応として拒否する。

CLIはカタログ内のファイルシステムリンクを拒否し、展開前に既存ファイル・リンクとの衝突を検査する。生成SKILLの出力先は空のディレクトリに限定し、前回の不要ファイルが混入するのを防ぐ。このCLIは汎用サンドボックスではなく、同じ権限で動く悪意ある別プロセスとの競合を完全に隔離するものではない。

## 検証と反映

- 回帰テスト35件: 成功（CLI・Webローダー・旧サンプル除去・セッション再構成・ZIP・パス検査）。
- TypeScript / Vite本番ビルド: 成功。
- `npm audit`: 検出0件（確認時点）。未公表の問題まで安全と保証するものではない。
- lint: エラーなし。既存のReact Fast Refresh用の警告7件は残る。
- ローカルの実ブラウザーで、デモ読込・行サンプルタブの削除・旧タブURLのフォールバック・SQL例の表示・サンプルを含まないセッション保存を確認した。

実装・ローカル検証の段階では公開環境を変更せず、利用者の承認後にGitHubへの反映とGitHub Pagesへのdeployを行う。公開反映の成否は[GitHub Actionsの実行結果](https://github.com/tsukaharakazuki/treasure-ai-data-catalog/actions/workflows/deploy.yml)で確認する。別環境にインストール済みのビルダースキルは自動上書きしない。

作成: Treasure Work
