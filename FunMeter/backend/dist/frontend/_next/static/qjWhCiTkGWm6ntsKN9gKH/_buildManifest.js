self.__BUILD_MANIFEST = {
  "__rewrites": {
    "afterFiles": [
      {
        "source": "/face/register"
      },
      {
        "source": "/face/:path*"
      },
      {
        "source": "/register-face/:path*"
      },
      {
        "source": "/admin/:path*"
      },
      {
        "source": "/admin/attendance/:path*"
      },
      {
        "source": "/auth/:path*"
      },
      {
        "source": "/recognize-image"
      },
      {
        "source": "/attendance-log"
      },
      {
        "source": "/orgs/:path*"
      },
      {
        "source": "/register-db-data"
      },
      {
        "source": "/register-dataset"
      },
      {
        "source": "/config"
      },
      {
        "source": "/config/reset"
      }
    ],
    "beforeFiles": [],
    "fallback": []
  },
  "sortedPages": [
    "/_app",
    "/_error"
  ]
};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()