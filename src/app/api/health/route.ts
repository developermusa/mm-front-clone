import { NextResponse } from 'next/server'

export async function GET() {
  const envCheck = {
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: !!process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
    NEXT_PUBLIC_BASE_URL: !!process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_DEFAULT_REGION: !!process.env.NEXT_PUBLIC_DEFAULT_REGION,
    NEXT_PUBLIC_STRIPE_KEY: !!process.env.NEXT_PUBLIC_STRIPE_KEY,
  }

  const allEnvVarsPresent = Object.values(envCheck).every(Boolean)

  return NextResponse.json({
    status: allEnvVarsPresent ? 'healthy' : 'unhealthy',
    environment: process.env.NODE_ENV,
    envVars: envCheck,
    timestamp: new Date().toISOString()
  })
}
