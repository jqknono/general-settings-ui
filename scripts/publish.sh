#!/usr/bin/env bash
#
# publish.sh - Build and publish VS Code extension to marketplaces
#
# Usage:
#   ./scripts/publish.sh [options]
#
# Options:
#   --target <marketplace>  Target marketplace: vscode, openvsx, all (default: all)
#   --skip-build            Skip compilation step (use existing build)
#   --dry-run               Package only, do not publish
#   --pre-release           Publish as pre-release version
#   --version <version>     Override version (e.g., 1.0.0, patch, minor, major)
#   -h, --help              Show this help message
#
# Environment Variables:
#   VSCE_PAT        - Personal Access Token for VS Code Marketplace
#   OVSX_PAT        - Personal Access Token for Open VSX Registry
#   OPEN_VSX_TOKEN  - Alternative name for Open VSX token (fallback)
#
# Examples:
#   ./scripts/publish.sh                        # Build and publish to all marketplaces
#   ./scripts/publish.sh --target vscode        # Publish only to VS Code Marketplace
#   ./scripts/publish.sh --target openvsx       # Publish only to Open VSX
#   ./scripts/publish.sh --dry-run              # Build and package without publishing
#   ./scripts/publish.sh --version patch        # Bump patch version and publish

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Default options
TARGET="all"
SKIP_BUILD=false
DRY_RUN=false
PRE_RELEASE=false
VERSION_OVERRIDE=""

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Tool versions (keep in sync with CI)
VSCE_VERSION="3.6.2"
OVSX_VERSION="0.10.6"

#######################################
# Print colored message
#######################################
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

#######################################
# Show usage
#######################################
usage() {
    sed -n '3,21p' "$0" | sed 's/^# \?//'
    exit 0
}

#######################################
# Parse command line arguments
#######################################
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --target)
                TARGET="$2"
                if [[ ! "$TARGET" =~ ^(vscode|openvsx|all)$ ]]; then
                    log_error "Invalid target: $TARGET. Must be one of: vscode, openvsx, all"
                    exit 1
                fi
                shift 2
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --pre-release)
                PRE_RELEASE=true
                shift
                ;;
            --version)
                VERSION_OVERRIDE="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done
}

#######################################
# Check prerequisites
#######################################
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed"
        exit 1
    fi
    
    # Check package.json exists
    if [[ ! -f "${PROJECT_ROOT}/package.json" ]]; then
        log_error "package.json not found in ${PROJECT_ROOT}"
        exit 1
    fi
    
    # Check publisher field
    local publisher
    publisher=$(node -p "require('${PROJECT_ROOT}/package.json').publisher || ''")
    if [[ -z "$publisher" ]]; then
        log_error "Missing 'publisher' field in package.json"
        log_info "Add a publisher field, e.g.: \"publisher\": \"your-publisher-id\""
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

#######################################
# Validate tokens for publishing
#######################################
validate_tokens() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run mode - skipping token validation"
        return 0
    fi
    
    log_info "Validating access tokens..."
    
    local missing_tokens=()
    
    if [[ "$TARGET" == "vscode" || "$TARGET" == "all" ]]; then
        if [[ -z "${VSCE_PAT:-}" ]]; then
            missing_tokens+=("VSCE_PAT (VS Code Marketplace)")
        fi
    fi
    
    if [[ "$TARGET" == "openvsx" || "$TARGET" == "all" ]]; then
        # Support both OVSX_PAT and OPEN_VSX_TOKEN
        if [[ -z "${OVSX_PAT:-}" && -z "${OPEN_VSX_TOKEN:-}" ]]; then
            missing_tokens+=("OVSX_PAT or OPEN_VSX_TOKEN (Open VSX Registry)")
        fi
        # Normalize to OVSX_PAT
        if [[ -z "${OVSX_PAT:-}" && -n "${OPEN_VSX_TOKEN:-}" ]]; then
            export OVSX_PAT="${OPEN_VSX_TOKEN}"
        fi
    fi
    
    if [[ ${#missing_tokens[@]} -gt 0 ]]; then
        log_error "Missing required access tokens:"
        for token in "${missing_tokens[@]}"; do
            echo "  - $token"
        done
        echo ""
        log_info "Set tokens as environment variables before running this script:"
        echo "  export VSCE_PAT='your-vscode-marketplace-token'"
        echo "  export OVSX_PAT='your-openvsx-token'"
        exit 1
    fi
    
    log_success "Access tokens validated"
}

#######################################
# Update version if requested
#######################################
update_version() {
    if [[ -z "$VERSION_OVERRIDE" ]]; then
        return 0
    fi
    
    log_info "Updating version to: $VERSION_OVERRIDE"
    
    cd "${PROJECT_ROOT}"
    
    if [[ "$VERSION_OVERRIDE" =~ ^(patch|minor|major)$ ]]; then
        npm version "$VERSION_OVERRIDE" --no-git-tag-version
    else
        npm version "$VERSION_OVERRIDE" --no-git-tag-version --allow-same-version
    fi
    
    local new_version
    new_version=$(node -p "require('./package.json').version")
    log_success "Version updated to: $new_version"
}

#######################################
# Install dependencies
#######################################
install_deps() {
    log_info "Installing dependencies..."
    cd "${PROJECT_ROOT}"
    npm ci
    log_success "Dependencies installed"
}

#######################################
# Build the extension
#######################################
build_extension() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warn "Skipping build (--skip-build specified)"
        return 0
    fi
    
    log_info "Building extension..."
    cd "${PROJECT_ROOT}"
    npm run compile
    log_success "Extension built successfully"
}

#######################################
# Package the extension
#######################################
package_extension() {
    log_info "Packaging extension..."
    cd "${PROJECT_ROOT}"
    
    local vsce_args=("package")
    
    if [[ "$PRE_RELEASE" == "true" ]]; then
        vsce_args+=("--pre-release")
    fi
    
    npx --yes "@vscode/vsce@${VSCE_VERSION}" "${vsce_args[@]}"
    
    # Find the generated .vsix file
    local vsix_file
    vsix_file=$(ls -t *.vsix 2>/dev/null | head -n1)
    
    if [[ -z "$vsix_file" ]]; then
        log_error "Failed to find packaged .vsix file"
        exit 1
    fi
    
    log_success "Extension packaged: $vsix_file"
    echo "$vsix_file"
}

#######################################
# Publish to VS Code Marketplace
#######################################
publish_vscode() {
    local vsix_file="$1"
    
    log_info "Publishing to VS Code Marketplace..."
    cd "${PROJECT_ROOT}"
    
    local vsce_args=("publish" "--packagePath" "$vsix_file" "--pat" "$VSCE_PAT")
    
    if [[ "$PRE_RELEASE" == "true" ]]; then
        vsce_args+=("--pre-release")
    fi
    
    npx --yes "@vscode/vsce@${VSCE_VERSION}" "${vsce_args[@]}"
    
    log_success "Published to VS Code Marketplace"
}

#######################################
# Publish to Open VSX Registry
#######################################
publish_openvsx() {
    local vsix_file="$1"
    
    log_info "Publishing to Open VSX Registry..."
    cd "${PROJECT_ROOT}"
    
    local ovsx_args=("publish" "$vsix_file" "-p" "$OVSX_PAT")
    
    if [[ "$PRE_RELEASE" == "true" ]]; then
        ovsx_args+=("--pre-release")
    fi
    
    npx --yes "ovsx@${OVSX_VERSION}" "${ovsx_args[@]}"
    
    log_success "Published to Open VSX Registry"
}

#######################################
# Main entry point
#######################################
main() {
    parse_args "$@"
    
    echo ""
    echo "=========================================="
    echo "  VS Code Extension Publisher"
    echo "=========================================="
    echo ""
    echo "Target:      $TARGET"
    echo "Skip Build:  $SKIP_BUILD"
    echo "Dry Run:     $DRY_RUN"
    echo "Pre-Release: $PRE_RELEASE"
    [[ -n "$VERSION_OVERRIDE" ]] && echo "Version:     $VERSION_OVERRIDE"
    echo ""
    
    check_prerequisites
    validate_tokens
    update_version
    install_deps
    build_extension
    
    local vsix_file
    vsix_file=$(package_extension | tail -n1)
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "Dry run mode - skipping actual publish"
        log_info "Package created: $vsix_file"
        log_info "To publish manually:"
        echo "  npx @vscode/vsce@${VSCE_VERSION} publish --packagePath $vsix_file --pat \$VSCE_PAT"
        echo "  npx ovsx@${OVSX_VERSION} publish $vsix_file -p \$OVSX_PAT"
        exit 0
    fi
    
    # Publish to selected marketplaces
    local publish_failed=false
    
    if [[ "$TARGET" == "vscode" || "$TARGET" == "all" ]]; then
        if ! publish_vscode "$vsix_file"; then
            log_error "Failed to publish to VS Code Marketplace"
            publish_failed=true
        fi
    fi
    
    if [[ "$TARGET" == "openvsx" || "$TARGET" == "all" ]]; then
        if ! publish_openvsx "$vsix_file"; then
            log_error "Failed to publish to Open VSX Registry"
            publish_failed=true
        fi
    fi
    
    echo ""
    if [[ "$publish_failed" == "true" ]]; then
        log_error "Some publish operations failed"
        exit 1
    else
        log_success "All publish operations completed successfully!"
    fi
}

main "$@"
