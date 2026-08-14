import { useState } from 'react'
import type { TreeNode } from '../../../preload/index'

interface FileTreeProps {
  nodes: TreeNode[]
  activePath: string | null
  onSelect: (node: TreeNode) => void
  onContextMenu: (node: TreeNode, e: React.MouseEvent) => void
}

export function FileTree({ nodes, activePath, onSelect, onContextMenu }: FileTreeProps): JSX.Element {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          activePath={activePath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  )
}

interface TreeItemProps {
  node: TreeNode
  activePath: string | null
  onSelect: (node: TreeNode) => void
  onContextMenu: (node: TreeNode, e: React.MouseEvent) => void
}

function TreeItem({ node, activePath, onSelect, onContextMenu }: TreeItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(node, e)
  }

  if (node.type === 'folder') {
    const isEmpty = !node.children || node.children.length === 0
    return (
      <li className="tree-folder">
        <div
          className="tree-row folder-row"
          onClick={() => setExpanded((e) => !e)}
          onContextMenu={handleContextMenu}
        >
          <span className="chevron">{isEmpty ? '' : expanded ? '▾' : '▸'}</span>
          <span className="tree-label">{node.name}</span>
        </div>
        {expanded && node.children && (
          <ul className="tree">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                activePath={activePath}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isActive = node.path === activePath
  return (
    <li className="tree-file">
      <div
        className={`tree-row file-row${isActive ? ' active' : ''}`}
        onClick={() => onSelect(node)}
        onContextMenu={handleContextMenu}
      >
        <span className="tree-label">{node.name.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')}</span>
      </div>
    </li>
  )
}
