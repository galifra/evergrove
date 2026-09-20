import { go } from '../router.js'
import { canonicalPath, sameEntry } from '@evergrove/rules/routes.js'
import { currentPath } from '../router.js'

// A real link (so it can be opened in a new tab, copied, bookmarked) that moves
// inside the open page when both places are served by the same entry.
export default function Link({ to, children, onClick, ...rest }) {
  const href = canonicalPath(to)
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return
        if (sameEntry(currentPath(), href)) {
          e.preventDefault()
          go(href)
        }
      }}
    >
      {children}
    </a>
  )
}
