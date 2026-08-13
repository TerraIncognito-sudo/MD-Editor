import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'

interface EditorProps {
  initialValue: string
  /** Fired on every content change (including Milkdown's own normalization). */
  onChange: (markdown: string) => void
  /** Fired only when the user actually edits (types, deletes, pastes). */
  onUserEdit: () => void
}

export function Editor({ initialValue, onChange, onUserEdit }: EditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onUserEditRef = useRef(onUserEdit)
  onUserEditRef.current = onUserEdit

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const crepe = new Crepe({
      root: host,
      defaultValue: initialValue
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    // `beforeinput` fires for genuine user edits (typing, deleting, pasting) but
    // never for Milkdown's programmatic setup, so it's a reliable dirty signal.
    const handleUserInput = (): void => onUserEditRef.current()
    host.addEventListener('beforeinput', handleUserInput)

    void crepe.create()

    return () => {
      host.removeEventListener('beforeinput', handleUserInput)
      // Crepe.destroy is async; we don't await it during unmount.
      void crepe.destroy()
    }
    // Editor is remounted per-file via a `key`, so we intentionally
    // only build it once with the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="milkdown-host" ref={hostRef} />
}
