import { useEffect, useRef, useState } from 'react'

interface PromptDialogProps {
  title: string
  initialValue: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * A small modal text-input dialog. Electron does not implement window.prompt(),
 * so we roll our own for naming files and folders.
 */
export function PromptDialog({
  title,
  initialValue,
  confirmLabel = 'OK',
  onSubmit,
  onCancel
}: PromptDialogProps): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    onSubmit(trimmed)
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <input
          ref={inputRef}
          className="modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        <div className="modal-actions">
          <button className="modal-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal-btn primary" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
