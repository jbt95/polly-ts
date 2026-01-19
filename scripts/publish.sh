#!/usr/bin/env bash

#
# Publish script for polly-ts packages
#
# Usage:
#   ./scripts/publish.sh [options]
#
# Options:
#   --dry-run       Show what would be published without actually publishing
#   --skip-tests    Skip running tests before publishing
#   --skip-build    Skip building packages (use existing dist/)
#   --package NAME  Only publish a specific package (e.g., --package core)
#   --force         Force publish even if version exists on npm
#   --help          Show this help message
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
DRY_RUN=false
SKIP_TESTS=false
SKIP_BUILD=false
FORCE=false
SPECIFIC_PACKAGE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --package)
      SPECIFIC_PACKAGE="$2"
      shift 2
      ;;
    --help)
      sed -n '3,17p' "$0"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Ordered list of packages (core first, then dependents)
# This ensures dependencies are published before dependents
PACKAGES=(
  "core"
  "http"
  "express"
  "fastify"
  "hono"
  "nestjs"
  "redis"
  "telemetry"
  "testing"
)

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  polly-ts Package Publisher${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}DRY RUN MODE - No packages will actually be published${NC}"
  echo ""
fi

# Function to get package version from package.json
get_local_version() {
  local pkg_dir="packages/$1"
  if [ -f "$pkg_dir/package.json" ]; then
    jq -r '.version' "$pkg_dir/package.json"
  else
    echo ""
  fi
}

# Function to get published version from npm
get_npm_version() {
  local pkg_name="@polly-ts/$1"
  npm view "$pkg_name" version 2>/dev/null || echo ""
}

# Function to check if version exists on npm
version_exists_on_npm() {
  local pkg_name="@polly-ts/$1"
  local version="$2"
  npm view "$pkg_name@$version" version &>/dev/null
}

# Step 1: Run tests (unless skipped)
if [ "$SKIP_TESTS" = false ]; then
  echo -e "${BLUE}Step 1: Running tests...${NC}"
  if ! pnpm test --run; then
    echo -e "${RED}Tests failed! Aborting publish.${NC}"
    exit 1
  fi
  echo -e "${GREEN}Tests passed!${NC}"
  echo ""
else
  echo -e "${YELLOW}Step 1: Skipping tests (--skip-tests)${NC}"
  echo ""
fi

# Step 2: Build packages (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
  echo -e "${BLUE}Step 2: Building packages...${NC}"
  if ! pnpm build; then
    echo -e "${RED}Build failed! Aborting publish.${NC}"
    exit 1
  fi
  echo -e "${GREEN}Build completed!${NC}"
  echo ""
else
  echo -e "${YELLOW}Step 2: Skipping build (--skip-build)${NC}"
  echo ""
fi

# Step 3: Check which packages need publishing
echo -e "${BLUE}Step 3: Checking package versions...${NC}"
echo ""

PACKAGES_TO_PUBLISH=()

for pkg in "${PACKAGES[@]}"; do
  # Skip if specific package requested and this isn't it
  if [ -n "$SPECIFIC_PACKAGE" ] && [ "$pkg" != "$SPECIFIC_PACKAGE" ]; then
    continue
  fi

  local_version=$(get_local_version "$pkg")

  if [ -z "$local_version" ]; then
    echo -e "${YELLOW}  [$pkg] No package.json found, skipping${NC}"
    continue
  fi

  npm_version=$(get_npm_version "$pkg")
  pkg_name="@polly-ts/$pkg"

  if [ -z "$npm_version" ]; then
    echo -e "${GREEN}  [$pkg] $local_version - NEW PACKAGE (not on npm)${NC}"
    PACKAGES_TO_PUBLISH+=("$pkg")
  elif [ "$local_version" = "$npm_version" ]; then
    if [ "$FORCE" = true ]; then
      echo -e "${YELLOW}  [$pkg] $local_version - Already published (--force enabled)${NC}"
      PACKAGES_TO_PUBLISH+=("$pkg")
    else
      echo -e "${BLUE}  [$pkg] $local_version - Already published, skipping${NC}"
    fi
  elif version_exists_on_npm "$pkg" "$local_version"; then
    if [ "$FORCE" = true ]; then
      echo -e "${YELLOW}  [$pkg] $local_version - Version exists (--force enabled)${NC}"
      PACKAGES_TO_PUBLISH+=("$pkg")
    else
      echo -e "${BLUE}  [$pkg] $local_version - Version already exists, skipping${NC}"
    fi
  else
    echo -e "${GREEN}  [$pkg] $npm_version -> $local_version - NEEDS PUBLISHING${NC}"
    PACKAGES_TO_PUBLISH+=("$pkg")
  fi
done

echo ""

# Step 4: Publish packages
if [ ${#PACKAGES_TO_PUBLISH[@]} -eq 0 ]; then
  echo -e "${YELLOW}No packages need publishing.${NC}"
  exit 0
fi

echo -e "${BLUE}Step 4: Publishing ${#PACKAGES_TO_PUBLISH[@]} package(s)...${NC}"
echo ""

PUBLISHED=0
FAILED=0

for pkg in "${PACKAGES_TO_PUBLISH[@]}"; do
  pkg_name="@polly-ts/$pkg"
  pkg_dir="packages/$pkg"
  local_version=$(get_local_version "$pkg")

  echo -e "${BLUE}Publishing $pkg_name@$local_version...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}  [DRY RUN] Would run: pnpm publish --filter $pkg_name --access public --no-git-checks${NC}"
    ((PUBLISHED++))
  else
    if pnpm publish --filter "$pkg_name" --access public --no-git-checks; then
      echo -e "${GREEN}  Successfully published $pkg_name@$local_version${NC}"
      ((PUBLISHED++))
    else
      echo -e "${RED}  Failed to publish $pkg_name${NC}"
      ((FAILED++))
    fi
  fi

  echo ""
done

# Summary
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}======================================${NC}"
echo -e "  Published: ${GREEN}$PUBLISHED${NC}"
echo -e "  Failed:    ${RED}$FAILED${NC}"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${YELLOW}This was a dry run. Run without --dry-run to actually publish.${NC}"
fi

if [ $FAILED -gt 0 ]; then
  exit 1
fi
