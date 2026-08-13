import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
// Theme color variables (light/dark) are defined in base.css, keyed on the
// document's data-theme attribute, so the editor follows the app theme toggle.
import { editorViewCtx } from '@milkdown/kit/core'
import { callCommand } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MarkType } from '@milkdown/kit/prose/model'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  turnIntoTextCommand
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'

/** The active formatting at the current cursor/selection. */
export interface SelectionState {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  heading: number // 0 = not a heading, otherwise the level
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
  codeBlock: boolean
}

export type StyleCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'quote'

export interface EditorHandle {
  runCommand: (cmd: StyleCommand) => void
}

interface EditorProps {
  initialValue: string
  onChange: (markdown: string) => void
  onUserEdit: () => void
  onSelectionChange: (state: SelectionState | null) => void
}

const EMPTY_STATE: SelectionState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  heading: 0,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false
}

function computeSelectionState(view: EditorView): SelectionState {
  const { state } = view
  const { selection, schema, storedMarks, doc } = state
  const { from, to, empty, $from } = selection

  const markActive = (type: MarkType | undefined): boolean => {
    if (!type) return false
    if (empty) return !!type.isInSet(storedMarks || $from.marks())
    return doc.rangeHasMark(from, to, type)
  }

  let heading = 0
  let bulletList = false
  let orderedList = false
  let blockquote = false
  let codeBlock = false
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'heading') heading = Number($from.node(d).attrs.level) || 0
    else if (name === 'bullet_list') bulletList = true
    else if (name === 'ordered_list') orderedList = true
    else if (name === 'blockquote') blockquote = true
    else if (name === 'code_block') codeBlock = true
  }

  return {
    bold: markActive(schema.marks.strong),
    italic: markActive(schema.marks.emphasis),
    strike: markActive(schema.marks.strike_through),
    code: markActive(schema.marks.inlineCode),
    heading,
    bulletList,
    orderedList,
    blockquote,
    codeBlock
  }
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { initialValue, onChange, onUserEdit, onSelectionChange },
  ref
): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lastStateRef = useRef<SelectionState>(EMPTY_STATE)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onUserEditRef = useRef(onUserEdit)
  onUserEditRef.current = onUserEdit
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  const refreshSelection = (): void => {
    const view = viewRef.current
    if (!view) return
    const next = computeSelectionState(view)
    lastStateRef.current = next
    onSelectionChangeRef.current(next)
  }

  useImperativeHandle(ref, () => ({
    runCommand: (cmd: StyleCommand) => {
      const crepe = crepeRef.current
      const view = viewRef.current
      if (!crepe || !view) return
      const run = <T,>(key: Parameters<typeof callCommand>[0], payload?: T): void => {
        crepe.editor.action(callCommand(key, payload))
      }
      switch (cmd) {
        case 'bold':
          run(toggleStrongCommand.key)
          break
        case 'italic':
          run(toggleEmphasisCommand.key)
          break
        case 'strike':
          run(toggleStrikethroughCommand.key)
          break
        case 'code':
          run(toggleInlineCodeCommand.key)
          break
        case 'bullet':
          run(wrapInBulletListCommand.key)
          break
        case 'ordered':
          run(wrapInOrderedListCommand.key)
          break
        case 'quote':
          run(wrapInBlockquoteCommand.key)
          break
        case 'h1':
        case 'h2':
        case 'h3': {
          const level = Number(cmd[1])
          if (lastStateRef.current.heading === level) {
            run(turnIntoTextCommand.key)
          } else {
            run(wrapInHeadingCommand.key, level)
          }
          break
        }
      }
      view.focus()
      refreshSelection()
    }
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const crepe = new Crepe({ root: host, defaultValue: initialValue })
    crepeRef.current = crepe

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
        refreshSelection()
      })
    })

    // `beforeinput` fires for genuine user edits (typing, deleting, pasting) but
    // never for Milkdown's programmatic setup, so it's a reliable dirty signal.
    const handleUserInput = (): void => onUserEditRef.current()
    host.addEventListener('beforeinput', handleUserInput)

    // Track cursor movement so the style bar reflects the current formatting.
    // Our listener may run before ProseMirror syncs its state from the DOM
    // selection, so defer the read a tick to let the editor state catch up.
    const handleSelection = (): void => {
      const view = viewRef.current
      if (!view) return
      const sel = document.getSelection()
      if (sel && sel.anchorNode && view.dom.contains(sel.anchorNode)) {
        setTimeout(refreshSelection, 0)
      }
    }
    document.addEventListener('selectionchange', handleSelection)

    void crepe.create().then(() => {
      viewRef.current = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
      refreshSelection()
    })

    return () => {
      host.removeEventListener('beforeinput', handleUserInput)
      document.removeEventListener('selectionchange', handleSelection)
      viewRef.current = null
      crepeRef.current = null
      onSelectionChangeRef.current(null)
      // Crepe.destroy is async; we don't await it during unmount.
      void crepe.destroy()
    }
    // Editor is remounted per-file via a `key`, so we intentionally
    // only build it once with the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="milkdown-host" ref={hostRef} />
})
