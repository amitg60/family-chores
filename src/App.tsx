import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from './components/ui/toaster'

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  )
}
