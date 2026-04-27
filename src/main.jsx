import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './polyfills'

async function bootstrap() {
  const { default: App } = await import('./App.jsx')

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()
