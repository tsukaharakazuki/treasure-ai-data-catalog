import { useRef, useState } from 'react'
import { ArrowDownToLine, Database, FileCode2, GitBranch, History, Layers3, MessageSquare, Network, Table2 } from 'lucide-react'
import { CopyButton } from '../components/common'
import { REPO_URL, STUDIO_PROMPT, UPDATE_PROMPT } from '../prompts'

interface LandingProps {
  onFile: (file: File) => void
  onSample: () => void
  loading: boolean
  error?: string
}

const FEATURES = [
  { icon: Table2, title: 'メタデータ', text: 'スキーマ・利用者の言語での論理名・説明・利用用途・マスク済みサンプルデータ' },
  { icon: Network, title: 'データリネージ', text: 'Source → テーブル → Workflow / Saved Query → Parent Segment の流れ' },
  { icon: Database, title: 'ER図', text: '結合キーとカーディナリティ。ID体系ごとの結合関係' },
  { icon: FileCode2, title: 'サンプルクエリ', text: 'テーブルごとの Trino クエリをワンクリックでコピー' },
  { icon: History, title: 'リビジョン管理', text: '定期更新のたびに採番し、任意の2版の差分を確認' },
  { icon: MessageSquare, title: '用語・処理事例', text: '「売上の合計」がテーブルごとに SUM(単価×個数) か MAX(注文合計) か' },
]

export function Landing({ onFile, onSample, loading, error }: LandingProps) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Treasure AI Studio × tdx</p>
        <h1>
          Treasure AI <span className="gradient">Data Catalog</span>
        </h1>
        <p className="lead">
          Treasure AI Studio が tdx で集めたメタデータ・リネージ・ER・用語集を、ブラウザだけで確認するビューアーです。
          ZIP はこの端末の中だけで読み込み、どこにも送信しません。
        </p>

        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) onFile(file)
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') input.current?.click() }}
        >
          <ArrowDownToLine size={28} />
          <strong>{loading ? '読み込み中…' : 'データカタログ ZIP をドロップ、またはクリックして選択'}</strong>
          <span className="muted">catalog.json を含む ZIP（treasure-ai-data-catalog 形式 v1）</span>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
              event.target.value = ''
            }}
          />
        </div>
        {error && <pre className="error-box">{error}</pre>}
        <div className="hero-actions">
          <button type="button" className="button primary" onClick={onSample} disabled={loading}>サンプルを開く</button>
          <a className="button ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener"><GitBranch size={15} /> GitHub</a>
        </div>
      </section>

      <section className="steps">
        <h2>使い方</h2>
        <ol>
          <li>
            <strong>Treasure AI Studio にプロンプトを貼り付ける</strong>
            <p>Studio がこのリポジトリを読み込み、どの情報（Parent Segment / Workflow / Saved Query / Source）をもとにするかを確認しながら、tdx でカタログを作ります。</p>
            <div className="prompt-box">
              <pre>{STUDIO_PROMPT}</pre>
              <CopyButton text={STUDIO_PROMPT} label="Studio用プロンプトをコピー" />
            </div>
          </li>
          <li>
            <strong>ZIP をダウンロードしてここで開く</strong>
            <p>テーブル・リネージ・ER図・用語・リビジョン差分を画面で確認します。</p>
          </li>
          <li>
            <strong><code>&lt;name&gt;-data-catalog</code> SKILL を配布する</strong>
            <p>同時に生成される SKILL を Studio に入れると、誰でも「売上の合計を出して」と聞くだけで、テーブルに合った SQL が返ります。</p>
          </li>
          <li>
            <strong>定期更新</strong>
            <p>前回の ZIP を添付して更新を依頼すると、新しいリビジョンが採番され、変更差分が CHANGELOG とリビジョン画面に残ります。</p>
            <div className="prompt-box">
              <pre>{UPDATE_PROMPT}</pre>
              <CopyButton text={UPDATE_PROMPT} label="更新用プロンプトをコピー" />
            </div>
          </li>
        </ol>
      </section>

      <section className="features">
        {FEATURES.map((feature) => (
          <div className="feature" key={feature.title}>
            <feature.icon size={18} />
            <strong>{feature.title}</strong>
            <p>{feature.text}</p>
          </div>
        ))}
        <div className="feature">
          <Layers3 size={18} />
          <strong>ローカルファースト</strong>
          <p>サーバーはありません。TD への接続・API キーの受け渡しもしません。</p>
        </div>
      </section>
    </div>
  )
}
