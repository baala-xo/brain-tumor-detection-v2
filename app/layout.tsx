import "./globals.css"
import type { Metadata } from "next"
import { Inter } from "next/font/google"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Brain Tumor Detection",
  description: "MRI brain tumor detection using ONNX model on Hugging Face",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <main className="min-h-screen bg-gray-50 text-gray-900 flex flex-col items-center justify-center p-6">
          {children}
        </main>
      </body>
    </html>
  )
}
