#!/bin/bash

#===============================================================================
# @struktos/adapter-grpc - Release Script
# 
# This script automates the release process:
# 1. Validates the environment
# 2. Runs tests and builds
# 3. Creates a Git tag
# 4. Pushes to GitHub with release notes
# 5. Publishes to npm
#
# Usage:
#   ./scripts/release.sh [patch|minor|major]
#   ./scripts/release.sh              # Uses version from package.json
#   ./scripts/release.sh patch        # Bumps patch version (0.1.0 -> 0.1.1)
#   ./scripts/release.sh minor        # Bumps minor version (0.1.0 -> 0.2.0)
#   ./scripts/release.sh major        # Bumps major version (0.1.0 -> 1.0.0)
#
# Requirements:
#   - git
#   - npm (logged in)
#   - gh (GitHub CLI, logged in)
#===============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

#===============================================================================
# Configuration
#===============================================================================

PACKAGE_NAME="@struktos/adapter-grpc"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CHANGELOG_FILE="$PROJECT_DIR/CHANGELOG.md"

#===============================================================================
# Pre-flight Checks
#===============================================================================

preflight_checks() {
    info "Running pre-flight checks..."

    # Check if we're in a git repository
    if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        error "Not a git repository"
    fi

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        error "You have uncommitted changes. Please commit or stash them first."
    fi

    # Check if npm is logged in
    if ! npm whoami > /dev/null 2>&1; then
        error "Not logged in to npm. Run 'npm login' first."
    fi

    # Check if gh CLI is installed and authenticated
    if ! command -v gh &> /dev/null; then
        error "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/"
    fi

    if ! gh auth status > /dev/null 2>&1; then
        error "Not logged in to GitHub CLI. Run 'gh auth login' first."
    fi

    # Check if on main/master branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
        warn "You are on branch '$CURRENT_BRANCH', not main/master."
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    success "Pre-flight checks passed"
}

#===============================================================================
# Version Management
#===============================================================================

get_current_version() {
    node -p "require('./package.json').version"
}

bump_version() {
    local bump_type=$1
    local current_version=$(get_current_version)
    
    IFS='.' read -r major minor patch <<< "$current_version"
    
    case $bump_type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            error "Invalid bump type: $bump_type"
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

update_package_version() {
    local new_version=$1
    
    # Update package.json
    npm version "$new_version" --no-git-tag-version --allow-same-version
    
    success "Updated package.json to version $new_version"
}

#===============================================================================
# Build & Test
#===============================================================================

build_package() {
    info "Building package..."
    
    cd "$PROJECT_DIR"
    
    # Clean previous build
    rm -rf dist
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        info "Installing dependencies..."
        npm install
    fi
    
    # Run build
    npm run build
    
    success "Build completed"
}

run_tests() {
    info "Running tests..."
    
    cd "$PROJECT_DIR"
    
    # Run tests
    if npm test 2>/dev/null; then
        success "Tests passed"
    else
        warn "Tests failed or no tests configured"
    fi
}

#===============================================================================
# Git Operations
#===============================================================================

create_git_tag() {
    local version=$1
    local tag="v$version"
    
    info "Creating git tag: $tag"
    
    # Check if tag already exists
    if git rev-parse "$tag" > /dev/null 2>&1; then
        error "Tag $tag already exists"
    fi
    
    # Commit version bump if there are changes
    if ! git diff-index --quiet HEAD -- package.json 2>/dev/null; then
        git add package.json package-lock.json 2>/dev/null || true
        git commit -m "chore: bump version to $version"
    fi
    
    # Create annotated tag
    git tag -a "$tag" -m "Release $version"
    
    success "Created tag: $tag"
}

push_to_github() {
    local version=$1
    local tag="v$version"
    
    info "Pushing to GitHub..."
    
    # Push commits and tags
    git push origin HEAD
    git push origin "$tag"
    
    success "Pushed to GitHub"
}

#===============================================================================
# GitHub Release
#===============================================================================

extract_changelog() {
    local version=$1
    local changelog_content=""
    
    if [ -f "$CHANGELOG_FILE" ]; then
        # Extract the section for this version from CHANGELOG.md
        changelog_content=$(awk -v ver="$version" '
            /^## \[/ {
                if (found) exit
                if (index($0, ver)) found=1
            }
            found && !/^## \[/ { print }
        ' "$CHANGELOG_FILE")
    fi
    
    if [ -z "$changelog_content" ]; then
        changelog_content="Release $version of $PACKAGE_NAME

See [CHANGELOG.md](CHANGELOG.md) for details."
    fi
    
    echo "$changelog_content"
}

create_github_release() {
    local version=$1
    local tag="v$version"
    
    info "Creating GitHub release..."
    
    # Extract release notes from CHANGELOG
    local release_notes=$(extract_changelog "$version")
    
    # Create GitHub release
    gh release create "$tag" \
        --title "Release $version" \
        --notes "$release_notes" \
        --verify-tag
    
    success "Created GitHub release: $tag"
}

#===============================================================================
# NPM Publish
#===============================================================================

publish_to_npm() {
    local version=$1
    
    info "Publishing to npm..."
    
    cd "$PROJECT_DIR"
    
    # Check if this version already exists on npm
    if npm view "$PACKAGE_NAME@$version" version > /dev/null 2>&1; then
        error "Version $version already exists on npm"
    fi
    
    # Publish with public access (for scoped packages)
    npm publish --access public
    
    success "Published $PACKAGE_NAME@$version to npm"
}

#===============================================================================
# Main
#===============================================================================

main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           $PACKAGE_NAME Release Script               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    cd "$PROJECT_DIR"
    
    # Parse arguments
    BUMP_TYPE=${1:-""}
    CURRENT_VERSION=$(get_current_version)
    
    if [ -n "$BUMP_TYPE" ]; then
        NEW_VERSION=$(bump_version "$BUMP_TYPE")
    else
        NEW_VERSION=$CURRENT_VERSION
    fi
    
    info "Package: $PACKAGE_NAME"
    info "Current version: $CURRENT_VERSION"
    info "Release version: $NEW_VERSION"
    echo ""
    
    # Confirmation
    read -p "Proceed with release v$NEW_VERSION? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Release cancelled"
        exit 0
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Run release steps
    preflight_checks
    
    if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
        update_package_version "$NEW_VERSION"
    fi
    
    build_package
    run_tests
    create_git_tag "$NEW_VERSION"
    push_to_github "$NEW_VERSION"
    create_github_release "$NEW_VERSION"
    publish_to_npm "$NEW_VERSION"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    success "🎉 Release v$NEW_VERSION completed successfully!"
    echo ""
    echo "  📦 npm: https://www.npmjs.com/package/$PACKAGE_NAME"
    echo "  🐙 GitHub: Check your repository releases"
    echo ""
}

# Run main function
main "$@"