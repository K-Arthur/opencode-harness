#!/bin/bash

# Act Setup Script for CachyOS/Arch Linux
# This script installs and configures act for local GitHub Actions testing

set -e

echo "🔧 Setting up act for local GitHub Actions testing..."

# Check if act is already installed
if command -v act &> /dev/null; then
    echo "✅ act is already installed: $(act --version)"
else
    echo "📦 Installing act via pacman..."
    sudo pacman -S act --noconfirm
    echo "✅ act installed successfully: $(act --version)"
fi

# Create .secrets file if it doesn't exist
if [ ! -f .secrets ]; then
    echo "🔐 Creating .secrets file template..."
    cat > .secrets << EOF
# GitHub Actions secrets for local testing
# Add your secrets here (optional)
# GITHUB_TOKEN=your_token_here
# OPENAI_API_KEY=your_key_here
EOF
    echo "✅ Created .secrets file (edit it to add secrets)"
else
    echo "✅ .secrets file already exists"
fi

# Create .actrc if it doesn't exist
if [ ! -f .actrc ]; then
    echo "⚙️  .actrc already exists, skipping creation"
else
    echo "⚙️  .actrc already configured"
fi

echo ""
echo "🎉 act setup complete!"
echo ""
echo "Usage examples:"
echo "  act push                    # Run all jobs for push event"
echo "  act pull_request             # Run all jobs for pull_request event"
echo "  act -j typecheck            # Run specific job"
echo "  act -j typecheck -j lint     # Run multiple specific jobs"
echo "  act --dry-run               # Show what would run without executing"
echo "  act -v                      # Verbose output"
echo ""
echo "For more information, see: docs/development/local-ci-testing.md"