# Use Node.js LTS as base image
FROM node:20-slim

# Install ffmpeg and other dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY index.mjs ./
COPY Wanderstories-logo.png ./
COPY favicon.ico ./

# Create necessary directories
RUN mkdir -p temp videos

# Expose port
EXPOSE 8090

# Set environment variable for port (can be overridden)
ENV PORT=8090

# Run the application
CMD ["node", "index.mjs"]

