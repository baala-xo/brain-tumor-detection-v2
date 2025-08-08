"use client"

import { useState } from "react"
import axios from "axios"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!file) {
      alert("Please select an image")
      return
    }

    const formData = new FormData()
    formData.append("file", file)

    try {
      setLoading(true)
      setPrediction(null)
      const res = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/predict`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      )
      setPrediction(res.data.prediction)
    } catch (error) {
      console.error(error)
      alert("Prediction failed. Check console.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Brain Tumor Detection</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input type="file" accept="image/*" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={loading}>
          {loading ? "Processing..." : "Upload & Predict"}
        </Button>
        {prediction && (
          <div className="mt-4 p-3 bg-green-100 text-green-800 rounded-lg">
            Prediction: {prediction}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
