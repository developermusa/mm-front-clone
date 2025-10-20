import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

// Dynamic fallback region - will be set based on actual backend data
let fallbackRegion: HttpTypes.StoreRegion | null = null

// Get default region from environment variable
const DEFAULT_REGION_CODE = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

async function getRegionMap() {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    console.log("Fetching regions from backend:", { 
      BACKEND_URL, 
      PUBLISHABLE_API_KEY: PUBLISHABLE_API_KEY ? "SET" : "NOT_SET" 
    })
    
    try {
      // Fetch regions from Medusa. We can't use the JS client here because middleware is running on Edge and the client needs a Node environment.
      const response = await fetch(`${BACKEND_URL}/store/regions`, {
        headers: {
          "x-publishable-api-key": PUBLISHABLE_API_KEY!,
        },
        next: {
          revalidate: 3600,
          tags: ["regions"],
        },
      })

      console.log("Backend response status:", response.status)

      if (!response.ok) {
        console.error(`Failed to fetch regions: ${response.status} ${response.statusText}`)
        console.error("Backend URL:", BACKEND_URL)
        console.error("Response headers:", Object.fromEntries(response.headers.entries()))
        return regionMapCache.regionMap
      }

      const data = await response.json()
      console.log("Regions response:", { regionsCount: data.regions?.length || 0 })
      
      const { regions } = data

      if (!regions?.length) {
        console.warn("No regions found in response")
        console.warn("Response data:", data)
        // Avoid using Next.js navigation API in Middleware; fall back gracefully
        return regionMapCache.regionMap
      }

      // Set dynamic fallback region - prioritize env variable, then first available region
      if (!fallbackRegion && regions.length > 0) {
        // First try to find the region matching the env variable
        const envRegion = regions.find((region: HttpTypes.StoreRegion) => 
          region.countries?.some(country => country.iso_2 === DEFAULT_REGION_CODE)
        )
        
        if (envRegion) {
          fallbackRegion = envRegion
          console.log(`Dynamic fallback region set from env (${DEFAULT_REGION_CODE}): ${envRegion.name}`)
        } else {
          // Fallback to first available region
          fallbackRegion = regions[0]
          console.log(`Dynamic fallback region set to first available: ${regions[0].name} (${regions[0].countries?.[0]?.iso_2})`)
        }
      }

      // Create a map of country codes to regions.
      regions.forEach((region: HttpTypes.StoreRegion) => {
        region.countries?.forEach((c) => {
          regionMapCache.regionMap.set(c.iso_2 ?? "", region)
        })
      })

      console.log("Available country codes:", Array.from(regionMapCache.regionMap.keys()))
      regionMapCache.regionMapUpdated = Date.now()
    } catch (error) {
      console.error("Error fetching regions from Medusa backend:", error)
      console.error("Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        BACKEND_URL,
        PUBLISHABLE_API_KEY: PUBLISHABLE_API_KEY ? "SET" : "NOT_SET"
      })
      // If this is the first request and we have no cached regions, use dynamic fallback
      if (!regionMapCache.regionMap.keys().next().value && fallbackRegion) {
        fallbackRegion.countries?.forEach((country) => {
          if (country.iso_2) {
            regionMapCache.regionMap.set(country.iso_2, fallbackRegion as HttpTypes.StoreRegion)
          }
        })
        regionMapCache.regionMapUpdated = Date.now()
      }
      return regionMapCache.regionMap
    }
  }

  return regionMapCache.regionMap
}

/**
 * Fetches regions from Medusa and sets the region cookie.
 * @param request
 * @param response
 */
async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion | number>
) {
  try {
    let countryCode

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase()

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value
    }

    // Fallback to environment variable if no region is found
    if (!countryCode) {
      countryCode = DEFAULT_REGION_CODE
      console.log(`No region found, using fallback: ${countryCode}`)
    }

    return countryCode
  } catch (error) {
    console.error("Middleware.ts: Error getting the country code:", error)
    // Return fallback region code even on error
    return DEFAULT_REGION_CODE
  }
}

/**
 * Middleware to handle region selection and onboarding status.
 */
export async function middleware(request: NextRequest) {
  try {
    console.log("Middleware processing request:", {
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      origin: request.nextUrl.origin
    })

    const regionMap = await getRegionMap()
    const countryCode = regionMap && (await getCountryCode(request, regionMap))

    console.log("Region detection result:", {
      regionMapSize: regionMap?.size || 0,
      countryCode,
      availableRegions: regionMap ? Array.from(regionMap.keys()) : []
    })

    const urlHasCountryCode =
      countryCode && request.nextUrl.pathname.split("/")[1].includes(countryCode)

    console.log("URL analysis:", {
      urlHasCountryCode,
      pathSegments: request.nextUrl.pathname.split("/"),
      firstSegment: request.nextUrl.pathname.split("/")[1]
    })

    // check if one of the country codes is in the url
    if (urlHasCountryCode) {
      console.log("Country code found in URL, proceeding")
      return NextResponse.next()
    }

    const redirectPath =
      request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname

    const queryString = request.nextUrl.search ? request.nextUrl.search : ""

    let redirectUrl = request.nextUrl.href

    let response = NextResponse.redirect(redirectUrl, 307)

    // If no country code is set, we redirect to the relevant region.
    if (!urlHasCountryCode && countryCode) {
      redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`
      response = NextResponse.redirect(`${redirectUrl}`, 307)
      console.log("Redirecting to:", redirectUrl)
    } else if (!countryCode) {
      console.warn("No country code available, using fallback")
      redirectUrl = `${request.nextUrl.origin}/${DEFAULT_REGION_CODE}${redirectPath}${queryString}`
      response = NextResponse.redirect(`${redirectUrl}`, 307)
    }

    return response
  } catch (error) {
    console.error("Middleware error:", error)
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      pathname: request.nextUrl.pathname
    })
    // Fallback: redirect to default region
    const redirectUrl = `${request.nextUrl.origin}/${DEFAULT_REGION_CODE}${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}${request.nextUrl.search || ""}`
    console.log("Fallback redirect to:", redirectUrl)
    return NextResponse.redirect(redirectUrl, 307)
  }
}

export const config = {
  matcher: [
    "/((?!api|_next/static|favicon.ico|_next/image|images|robots.txt).*)",
  ],
}
