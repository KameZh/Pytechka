import { useRef, useState } from 'react'
import './CameraButton.css'

export default function CameraButton({
  onPhotoCapture,
  className = '',
  beforeCapture = null,
}) {
  const [isCapturing, setIsCapturing] = useState(false)
  const fileInputRef = useRef(null)

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  const compressDataUrl = async (dataUrl) =>
    new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        const maxSize = 960
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(dataUrl)
          return
        }

        ctx.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.58))
      }
      image.onerror = () => resolve(dataUrl)
      image.src = dataUrl
    })

  const compressImageFile = async (file) => {
    const originalDataUrl = await readFileAsDataUrl(file)
    return compressDataUrl(originalDataUrl)
  }

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsCapturing(true)
    try {
      const dataUrl = await compressImageFile(file)
      onPhotoCapture?.({
        dataUrl,
        webPath: dataUrl,
        path: file.name,
      })
    } catch (error) {
      console.error('Photo file read error:', error)
    } finally {
      setIsCapturing(false)
    }
  }

  const handleCapture = async () => {
    if (isCapturing) return
    if (typeof beforeCapture === 'function' && beforeCapture() === false) {
      return
    }

    setIsCapturing(true)
    try {
      const cameraPackage = '@capacitor/' + 'camera'
      const { Camera, CameraResultType, CameraSource } = await import(
        /* @vite-ignore */ cameraPackage
      )
      const result = await Camera.getPhoto({
        quality: 58,
        allowEditing: false,
        saveToGallery: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })

      if (result?.dataUrl || result?.webPath || result?.path) {
        const dataUrl = result.dataUrl
          ? await compressDataUrl(result.dataUrl)
          : result.webPath || result.path
        onPhotoCapture?.({
          ...result,
          dataUrl,
          webPath: dataUrl,
        })
      }
    } catch (error) {
      if (
        error?.message?.includes('Failed to fetch dynamically imported') ||
        error?.message?.includes('Failed to resolve module specifier')
      ) {
        openFilePicker()
      } else {
        console.error('Camera capture error:', error)
        openFilePicker()
      }
    } finally {
      setIsCapturing(false)
    }
  }

  return (
    <>
      <button
        className={`camera-button ${className} ${isCapturing ? 'capturing' : ''}`}
        onClick={handleCapture}
        disabled={isCapturing}
        aria-label="Take photo"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="camera-file-input"
        onChange={handleFileChange}
      />
    </>
  )
}
