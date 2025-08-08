import BrainTumorUploader from "@/components/brain-tumor-uploader"

export default function Page() {
return (
  <main className="min-h-[100dvh] w-full flex items-center justify-center p-4">
    <div className="w-full max-w-3xl">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Brain Tumor Detection</h1>
        <p className="mt-2 text-sm text-muted-foreground">
  Upload a brain MRI image to get an AI-powered probabilistic prediction. This is a solo-built open-source project, and you're welcome to contribute—whether it’s <span className="font-medium">model tuning</span>, <span className="font-medium">UI</span>, or <span className="font-medium">backend engineering</span>.{' '}
  <a
    href="https://github.com/baala-xo/brain-tumor-detection-v2"
    target="_blank"
    rel="noreferrer"
    className="font-medium underline underline-offset-4"
  >
    Contribute on GitHub
  </a>{' '}
  or try it out on{' '}
  <a
    href="https://huggingface.co/spaces/balaaa6414/brain-tumor-api"
    target="_blank"
    rel="noreferrer"
    className="font-medium underline underline-offset-4"
  >
    Hugging Face Spaces
  </a>
  . Bring your PRs, benchmarks, or just come to vibe.
</p>

<p className="mt-1 text-sm text-muted-foreground font-bold">
  Note: This is a machine learning prediction. Always interpret results in a clinical context.
</p>

      </header>

      <BrainTumorUploader />
    </div>
  </main>
)
}
