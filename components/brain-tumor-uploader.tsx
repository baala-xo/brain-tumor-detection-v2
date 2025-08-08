'use client'

import { useEffect, useMemo, useRef, useState } from "react"
import axios from "axios"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { AlertCircle, CheckCircle2, FileImage, ImagePlus, Loader2, UploadCloud, X, RefreshCw, Info } from 'lucide-react'

type TopK = { label: string; confidence: number }
type PredictResult = {
  prediction?: string
  confidence?: number
  topK?: TopK[]
  version?: string
  latencyMs?: number
  [key: string]: unknown
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MIN_WIDTH = 256
const MIN_HEIGHT = 256

export default function BrainTumorUploader() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "ready" | "uploading" | "success" | "error">("idle")
  const [errors, setErrors] = useState<string[]>([])
  const [result, setResult] = useState<PredictResult | null>(null)

  const [progress, setProgress] = useState<number>(0)
  const [uploadedBytes, setUploadedBytes] = useState<number>(0)
  const [totalBytes, setTotalBytes] = useState<number>(0)
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)

  const [isPasting, setIsPasting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const statusLiveRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const apiEndpoint = useMemo(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL || "").trim()
    const normalized = base ? base.replace(/\/$/, "") : ""
    return `${normalized}/predict`
  }, [])

  // Helpers
  function humanFileSize(bytes: number) {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  function formatEta(s: number) {
    if (s < 1) return "<1s"
    if (s < 60) return `${Math.round(s)}s`
    const m = Math.floor(s / 60)
    const r = Math.round(s % 60)
    return `${m}m ${r}s`
  }

  function looksLikeHTML(s: string) {
    const t = s.trim().toLowerCase()
    return t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("</html>") || t.includes("<head") || t.includes("<body")
  }

  function revokePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }

  function resetAll() {
    controllerRef.current?.abort()
    revokePreview()
    setFile(null)
    setPreviewUrl(null)
    setStatus("idle")
    setErrors([])
    setResult(null)
    setProgress(0)
    setUploadedBytes(0)
    setTotalBytes(0)
    setEtaSeconds(null)
    startTimeRef.current = null
  }

  // Validation
  function validateBasic(f: File): string[] {
    const errs: string[] = []
    if (!ALLOWED_TYPES.includes(f.type)) {
      errs.push(`Unsupported file type: ${f.type || "unknown"}. Allowed: JPEG, PNG, WEBP.`)
    }
    if (f.size > MAX_SIZE_BYTES) {
      errs.push(`File is too large: ${humanFileSize(f.size)}. Max allowed is ${humanFileSize(MAX_SIZE_BYTES)}.`)
    }
    return errs
  }

  async function validateDimensions(f: File): Promise<string[]> {
    const errs: string[] = []
    try {
      const url = URL.createObjectURL(f)
      const img = new Image()
      img.crossOrigin = "anonymous"
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        img.onload = () => resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height })
        img.onerror = () => reject(new Error("Image could not be loaded for dimension check."))
        img.src = url
      })
      URL.revokeObjectURL(url)
      if (dims.w < MIN_WIDTH || dims.h < MIN_HEIGHT) {
        errs.push(`Image is too small (${dims.w}×${dims.h}). Minimum required is ${MIN_WIDTH}×${MIN_HEIGHT}.`)
      }
    } catch {
      errs.push("Could not read image dimensions. Please try another file.")
    }
    return errs
  }

  async function setFileWithValidation(f: File) {
    const basicErrs = validateBasic(f)
    const dimErrs = await validateDimensions(f)
    const all = [...basicErrs, ...dimErrs]
    if (all.length) {
      setErrors(all)
      setStatus("error")
      setTimeout(() => errorRef.current?.focus(), 0)
      return
    }
    revokePreview()
    setErrors([])
    const url = URL.createObjectURL(f)
    setFile(f)
    setPreviewUrl(url)
    setStatus("ready")
  }

  // Event handlers: select, drag-drop, paste
  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) await setFileWithValidation(e.target.files[0])
  }

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) await setFileWithValidation(f)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const onDragLeave = () => setIsDragging(false)

  const onPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    try {
      setIsPasting(true)
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile()
          if (blob) {
            const pastedFile = new File([blob], "pasted-image.png", { type: blob.type || "image/png" })
            await setFileWithValidation(pastedFile)
            break
          }
        }
      }
    } finally {
      setIsPasting(false)
    }
  }

  // Upload with retry/backoff and progress
  async function uploadWithRetry(f: File, maxAttempts = 3) {
    let attempt = 0
    let lastError: unknown = null

    while (attempt < maxAttempts) {
      attempt++
      try {
        await uploadOnce(f)
        return
      } catch (err) {
        lastError = err
        if (axios.isCancel?.(err) || (err instanceof DOMException && err.name === "AbortError")) {
          throw err
        }
        const status = (err as any)?.response?.status as number | undefined
        if (status && status < 500) break
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 8000) + Math.floor(Math.random() * 200)
        await new Promise((res) => setTimeout(res, delay))
      }
    }
    throw lastError
  }

  async function uploadOnce(f: File) {
    const formData = new FormData()
    formData.append("file", f)

    const controller = new AbortController()
    controllerRef.current = controller
    startTimeRef.current = Date.now()
    setUploadedBytes(0)
    setTotalBytes(f.size)
    setEtaSeconds(null)
    setProgress(0)

    const res = await axios.post(apiEndpoint, formData, {
      headers: { "Content-Type": "multipart/form-data", "Accept": "application/json" },
      signal: controller.signal,
      onUploadProgress: (e) => {
        const loaded = e.loaded ?? 0
        const total = e.total ?? f.size
        setUploadedBytes(loaded)
        setTotalBytes(total)
        const pct = total ? Math.round((loaded / total) * 100) : 0
        setProgress(pct)

        const startedAt = startTimeRef.current
        if (startedAt && total) {
          const elapsed = (Date.now() - startedAt) / 1000
          const rate = loaded / Math.max(elapsed, 0.001)
          const remaining = Math.max(total - loaded, 0)
          const eta = rate > 0 ? remaining / rate : null
          setEtaSeconds(eta ? Math.max(0, eta) : null)
        }
      },
    })

    const ct = (res.headers?.["content-type"] || res.headers?.["Content-Type"] || "").toLowerCase()
    let data: any = res.data

    if (typeof data === "string") {
      const trimmed = data.trim()
      const isHtml = looksLikeHTML(trimmed) || ct.includes("text/html")
      const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[")
      if (looksJson) {
        try {
          data = JSON.parse(trimmed)
        } catch { /* ignore */ }
      } else if (isHtml) {
        throw new Error("The prediction endpoint returned HTML instead of JSON. Please verify NEXT_PUBLIC_API_URL and that /predict returns JSON.")
      }
    }

    const normalized: PredictResult = {
      prediction:
        typeof data?.prediction === "string"
          ? data.prediction
          : typeof data === "string"
          ? data
          : undefined,
      confidence: typeof data?.confidence === "number" ? data.confidence : undefined,
      topK: Array.isArray(data?.topK) ? data.topK : undefined,
      version: typeof data?.version === "string" ? data.version : undefined,
      latencyMs: typeof data?.latencyMs === "number" ? data.latencyMs : undefined,
    }

    const isJson = ct.includes("application/json") || ct.includes("application/problem+json")
    if (!normalized.prediction && !isJson) {
      throw new Error("Unexpected response from server. Expected JSON but received another format. Check the /predict endpoint.")
    }

    setResult(normalized)
  }

  async function handleUpload() {
    if (!file) {
      setErrors(["Please select an image before uploading."])
      setStatus("error")
      setTimeout(() => errorRef.current?.focus(), 0)
      return
    }
    try {
      setStatus("uploading")
      setResult(null)
      setErrors([])

      toast("Starting upload", { description: "Your image is being uploaded and processed..." })
      await uploadWithRetry(file, 3)

      setStatus("success")
      toast.success("Prediction complete", { description: "The model returned a result successfully." })
      setTimeout(() => resultHeadingRef.current?.focus(), 0)
    } catch (error: any) {
      setStatus("error")
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        "Prediction failed due to a network or server error."
      setErrors([msg])
      setTimeout(() => errorRef.current?.focus(), 0)
      toast.error("Prediction failed", { description: msg })
    } finally {
      controllerRef.current = null
      startTimeRef.current = null
    }
  }

  function handleCancel() {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus("ready")
    setProgress(0)
    setUploadedBytes(0)
    setEtaSeconds(null)
    toast("Upload canceled", { description: "You canceled the current upload." })
  }

  // Status text for SR
  const statusText = (() => {
    switch (status) {
      case "idle":
        return "Idle. No image selected."
      case "ready":
        return file ? `Ready to upload ${file.name}.` : "Ready."
      case "uploading": {
        const pct = `${progress}%`
        const eta = etaSeconds != null ? ` Approximately ${formatEta(etaSeconds)} remaining.` : ""
        return `Uploading: ${pct} complete.${eta}`
      }
      case "success":
        return "Prediction complete."
      case "error":
        return "An error occurred."
      default:
        return ""
    }
  })()

  useEffect(() => {
    if (statusLiveRef.current) statusLiveRef.current.textContent = statusText
  }, [statusText])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      revokePreview()
    }
  }, [])

  const ctaLabel = status === "uploading" ? "Processing..." : file ? "Upload & Predict" : "Select an image"
  const ctaDisabled = status === "uploading" || (!file && status !== "error")

  function normalizeLabel(label?: string) {
    return (label || '').toLowerCase().trim().replace(/[^a-z]/g, '')
  }

  function classifyPrediction(pred?: string) {
    const n = normalizeLabel(pred)

    // Common "no tumor" variants
    const isNoTumor =
      n.includes('notumor') ||
      n.includes('notumour') ||
      n === 'normal' ||
      n === 'healthy' ||
      n.includes('negative') ||
      n.includes('absenceoftumor')

    if (isNoTumor) {
      return {
        kind: 'negative' as const,
        title: 'No tumor detected',
        description:
          'The model did not detect evidence of a tumor in the provided image. False negatives are possible—interpret with clinical context.',
        classes: {
          container: 'border-emerald-300 bg-emerald-50 text-emerald-950',
          icon: 'text-emerald-700',
        },
      }
    }

    if (pred) {
      return {
        kind: 'positive' as const,
        title: 'Tumor likely detected',
        description:
          'One or more tumor-related classes were predicted. This is not a diagnosis—please consult a qualified clinician.',
        classes: {
          container: 'border-red-300 bg-red-50 text-red-950',
          icon: 'text-red-700',
        },
      }
    }

    return {
      kind: 'unknown' as const,
      title: 'Prediction unavailable',
      description:
        'The model did not return a recognizable label. Try another image or try again later.',
      classes: {
        container: 'border-slate-300 bg-slate-50 text-slate-900',
        icon: 'text-slate-700',
      },
    }
  }

  async function useSample(path: string, name: string) {
    const res = await fetch(path)
    const blob = await res.blob()
    const sampleFile = new File([blob], name, { type: blob.type || "image/jpeg" })
    await setFileWithValidation(sampleFile)
  }

  return (
    <Card className="w-full shadow-lg">
      {/* Removed repeated title; keep aria-live region */}
      <CardHeader>
        <div ref={statusLiveRef} className="sr-only" aria-live="polite" aria-atomic="true" />
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drag and drop zone (supports paste, no dedicated paste button) */}
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onPaste={onPaste}
          className={cn(
            "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 outline-none transition",
            isDragging ? "border-emerald-600 bg-emerald-50/50" : "border-muted-foreground/20 hover:bg-muted/30",
            "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600"
          )}
          aria-label="Image dropzone. Press Enter to browse. You can also paste an image from your clipboard."
        >
          <UploadCloud className="h-8 w-8 text-emerald-700" aria-hidden="true" />
          <div className="text-sm text-center">
            <span className="font-medium">Drag and drop</span> an image here,{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="underline underline-offset-4 text-emerald-700 font-medium"
            >
              click to browse
            </button>
            , or press <span className="font-mono">Ctrl/⌘ + V</span> to paste.
          </div>
          <div className="text-xs text-muted-foreground">
            JPEG, PNG or WEBP. Max {humanFileSize(MAX_SIZE_BYTES)}. Min {MIN_WIDTH}×{MIN_HEIGHT}px.
          </div>

          <Input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            onChange={onFileInputChange}
            className="absolute inset-0 h-0 w-0 opacity-0"
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>

        {/* Sample images */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Try sample:</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => useSample("/images/sample-tumor.jpg", "sample-tumor.jpg")}
          >
            <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Tumor MRI
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => useSample("/images/sample-healthy.jpg", "sample-healthy.jpg")}
          >
            <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Healthy MRI
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            className="ml-auto"
          >
            <FileImage className="mr-2 h-4 w-4" aria-hidden="true" />
            Browse…
          </Button>
          {/* Removed "Paste here" button; paste still works in the dropzone */}
        </div>

        {/* File info + actions */}
        {file && (
          <div className="flex items-center justify-between rounded-md border bg-card p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Selected</Badge>
                <div className="truncate font-medium">{file.name}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {humanFileSize(file.size)} • {file.type || "unknown type"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                Change
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={resetAll} aria-label="Remove image">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Preview */}
        {previewUrl && (
          <div className="overflow-hidden rounded-lg border">
            <img
              src={previewUrl || "/placeholder.svg?height=360&width=640&query=preview-placeholder"}
              alt={file ? `Preview of ${file.name}` : "Selected image preview"}
              className="block max-h-[360px] w-full object-contain bg-muted"
            />
          </div>
        )}

        {/* Inline errors */}
        {errors.length > 0 && (
          <Alert
            ref={errorRef}
            variant="destructive"
            tabIndex={-1}
            aria-live="assertive"
            className="scroll-m-20"
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>There was a problem</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Progress */}
        {status === "uploading" && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />
                <span>Uploading...</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {humanFileSize(uploadedBytes)} / {humanFileSize(totalBytes)}
              </div>
            </div>
            <Progress value={progress} aria-label={`Upload progress ${progress}%`} />
            <div className="text-xs text-muted-foreground">
              {progress}% complete{etaSeconds != null ? ` • ~${formatEta(etaSeconds)} remaining` : ""}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={status === "uploading" ? handleCancel : handleUpload}
          disabled={ctaDisabled}
          className={cn(status === "uploading" && "bg-emerald-700 hover:bg-emerald-700/90")}
        >
          {status === "uploading" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Cancel
            </>
          ) : (
            <>
              <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
              {ctaLabel}
            </>
          )}
        </Button>

        <Button type="button" variant="outline" onClick={resetAll} disabled={status === "uploading"}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Reset
        </Button>

        {status === "error" && (
          <Button type="button" variant="secondary" onClick={handleUpload}>
            Try again
          </Button>
        )}

        {status === "success" && (
          <div className="ml-auto inline-flex items-center text-emerald-700 text-sm">
            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Ready
          </div>
        )}
      </CardFooter>

      {/* Results with prominent disclaimer */}
      {status === "success" && result && (
        <div className="px-6 pb-6">
          <div className="rounded-lg border bg-card p-4">
            {/* Prominent disclaimer */}
            <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-950">
              <Info className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                This AI model is under continuous training. Predictions are probabilistic and not 100% accurate.
                The output is not a medical diagnosis. Always consult a qualified healthcare professional and
                interpret results with caution.
              </AlertDescription>
            </Alert>

            <h2
              ref={resultHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold focus:outline-none"
            >
              Prediction Result
            </h2>

            {(() => {
              const classification = classifyPrediction(result.prediction)
              return (
                <Alert className={cn('mb-2', classification.classes.container)}>
                  {classification.kind === 'negative' ? (
                    <CheckCircle2 className={cn('h-4 w-4', classification.classes.icon)} aria-hidden="true" />
                  ) : classification.kind === 'positive' ? (
                    <AlertCircle className={cn('h-4 w-4', classification.classes.icon)} aria-hidden="true" />
                  ) : (
                    <AlertCircle className={cn('h-4 w-4', classification.classes.icon)} aria-hidden="true" />
                  )}
                  <AlertTitle>{classification.title}</AlertTitle>
                  <AlertDescription>
                    {classification.description}
                    <div className="mt-2 text-xs text-muted-foreground">
                      Model label: <span className="font-medium text-foreground">{result.prediction ?? 'Unknown'}</span>
                    </div>
                  </AlertDescription>
                </Alert>
              )
            })()}

            {typeof result.confidence === "number" && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm">
                  <span>Confidence</span>
                  <span className="text-muted-foreground">{Math.round(result.confidence * 100)}%</span>
                </div>
                <Progress value={Math.min(100, Math.max(0, Math.round(result.confidence * 100)))} />
              </div>
            )}

            {Array.isArray(result.topK) && result.topK.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2">Top predictions</div>
                <ul className="space-y-2">
                  {result.topK.map((item, idx) => {
                    const pct = Math.round(item.confidence * 100)
                    return (
                      <li key={idx} className="flex items-center gap-3">
                        <div className="w-40 truncate">{item.label}</div>
                        <div className="flex-1">
                          <Progress value={pct} aria-label={`${item.label} ${pct}%`} />
                        </div>
                        <div className="w-12 text-right text-sm text-muted-foreground">{pct}%</div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {typeof result.version === "string" && (
                <div>Model version: <span className="font-medium text-foreground">{result.version}</span></div>
              )}
              {typeof result.latencyMs === "number" && (
                <div>Inference time: <span className="font-medium text-foreground">{result.latencyMs} ms</span></div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
