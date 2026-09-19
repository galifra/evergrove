import { useEffect, useState } from 'react'

function parse() {
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const [, first, second] = hash.split('/')
  return { name: first || 'home', param: second ? decodeURIComponent(second) : null }
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function go(path) {
  window.location.hash = path
}
