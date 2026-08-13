import type { SelectionState, StyleCommand } from './Editor'

interface StyleBarProps {
  state: SelectionState | null
  onCommand: (cmd: StyleCommand) => void
}

interface ButtonSpec {
  cmd: StyleCommand
  label: string
  title: string
  active: (s: SelectionState) => boolean
}

const BUTTONS: ButtonSpec[] = [
  { cmd: 'bold', label: 'B', title: 'Bold', active: (s) => s.bold },
  { cmd: 'italic', label: 'I', title: 'Italic', active: (s) => s.italic },
  { cmd: 'strike', label: 'S', title: 'Strikethrough', active: (s) => s.strike },
  { cmd: 'code', label: '</>', title: 'Inline code', active: (s) => s.code },
  { cmd: 'h1', label: 'H1', title: 'Heading 1', active: (s) => s.heading === 1 },
  { cmd: 'h2', label: 'H2', title: 'Heading 2', active: (s) => s.heading === 2 },
  { cmd: 'h3', label: 'H3', title: 'Heading 3', active: (s) => s.heading === 3 },
  { cmd: 'bullet', label: '• List', title: 'Bullet list', active: (s) => s.bulletList },
  { cmd: 'ordered', label: '1. List', title: 'Numbered list', active: (s) => s.orderedList },
  { cmd: 'quote', label: '❝ Quote', title: 'Blockquote', active: (s) => s.blockquote }
]

export function StyleBar({ state, onCommand }: StyleBarProps): JSX.Element {
  const disabled = state === null
  return (
    <div className="style-bar">
      {BUTTONS.map((b, i) => {
        const isActive = state ? b.active(state) : false
        const needsDivider = b.cmd === 'h1' || b.cmd === 'bullet'
        return (
          <span key={b.cmd} className="style-group">
            {needsDivider && i !== 0 && <span className="style-divider" />}
            <button
              className={`style-btn style-${b.cmd}${isActive ? ' active' : ''}`}
              title={b.title}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault() /* keep editor selection */}
              onClick={() => onCommand(b.cmd)}
            >
              {b.label}
            </button>
          </span>
        )
      })}
    </div>
  )
}
