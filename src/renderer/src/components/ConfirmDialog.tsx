import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A small modal yes/no dialog, matching the app chrome (unlike window.confirm). */
export function ConfirmDialog({
  message,
  confirmLabel = 'OK',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          <button className="modal-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={`modal-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
