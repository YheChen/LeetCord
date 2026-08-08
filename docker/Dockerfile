# Single image shared by all four services (migrate, api, bot, worker).
#
# These used to be three near-identical Dockerfiles. Since every service needs the same
# workspace, the same node_modules and the same Prisma client, splitting them meant
# building and unpacking roughly four copies of the same ~1.5GB image in parallel —
# which saturated disk I/O badly enough that containerd dropped the build connection.
# The services differ only in their `command`, so one image is both correct and far
# cheaper. See docker-compose.yml.

FROM node:20-alpine

WORKDIR /app

# Prisma's query engine links against OpenSSL and its version detection is unreliable
# on Alpine without this, producing a confusing "Unable to require libquery_engine"
# at runtime rather than a clear failure at build time.
RUN apk add --no-cache openssl

COPY package.json pnpm-workspace.yaml tsconfig.base.json .eslintrc.cjs .prettierrc ./
COPY packages ./packages
COPY apps ./apps

# Pin pnpm rather than using `corepack enable pnpm`, which resolves to whatever pnpm is
# latest at build time. That silently broke this image the day pnpm 11 shipped: pnpm 11
# requires Node >= 22.13 and imports node:sqlite, which does not exist on Node 20.
#
# Installed via npm rather than corepack because the corepack bundled with Node 20 is
# old enough to hit signature-verification failures fetching recent pnpm releases.
#
# Keep this in step with "packageManager" in the root package.json.
RUN npm install -g pnpm@10.31.0 && pnpm install --recursive --silent

# Generate the Prisma client explicitly rather than relying on the @prisma/client
# postinstall hook. The query engine is a native, architecture-specific binary, so it
# must be produced on the machine that runs the image — this is what makes moving from
# an arm64 Raspberry Pi to an x86_64 host safe.
RUN pnpm --filter @leetcord/database prisma:generate

# Build every workspace package and app. Apps resolve each other through their dist/
# output, so a per-app build would need its dependencies compiled first anyway.
RUN pnpm -r run build

# Overridden per service in docker-compose.yml.
CMD ["pnpm", "--filter", "@leetcord/bot", "start"]
