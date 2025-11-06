#!/usr/bin/env python3
import os, argparse, uvicorn
from dotenv import load_dotenv

def main(): 
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
    p = argparse.ArgumentParser()
    p.add_argument("--cuda", action="store_true", help="Use CUDA backend for OpenCV DNN")
    p.add_argument("--redis", action="store_true", help="Enable Redis face DB")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5000)
    p.add_argument("--reload", action="store_true")
    p.add_argument("--sqldb", action="store_true", help="Use SQLite database (USE_SQLDB=1)")
    args = p.parse_args() 

    # === CUDA / CPU ===
    if args.cuda:
        os.environ["OPENCV_BACKEND"] = "cuda"
    else:
        os.environ.setdefault("OPENCV_BACKEND", "cpu")

    # === SQL DB ===
    if args.sqldb:
        os.environ["USE_SQLDB"] = "1"

    # Optimize uvicorn settings for better performance
    uvicorn.run(
        "main_fastapi:sio_app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # Performance optimizations
        workers=1 if args.reload else None,  # Single worker for development, auto for production
        loop="asyncio",  # Use asyncio event loop
        access_log=False,  # Disable access logs for better performance
        log_level="info",
        # Connection optimizations
        limit_concurrency=1000,
        limit_max_requests=10000,
        timeout_keep_alive=30,
    )

if __name__ == "__main__":
    main()
