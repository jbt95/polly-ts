# TypeScript Conventions

## Imports

- Do **not** include `.js` extensions in imports
- Use `import type` for type-only imports
- Prefer named exports over default exports

## Types

- Use `interface` for object shapes that can be extended
- Use `type` for unions, intersections, and mapped types
- Use `readonly` for immutable properties
- Don't use `any`, prefer `unknown` when the type is not known
- Enable and respect `exactOptionalPropertyTypes`

## Error Handling

- Extend `PolicyError` for policy-specific errors
- Always include `Error.captureStackTrace` for V8 compatibility
- Use `ErrorOptions` for error cause chaining

## Naming

- `IPolicy` prefix for core interfaces (following .NET Polly convention)
- PascalCase for types, interfaces, and classes
- camelCase for functions and variables
- UPPER_CASE for constants

## Documentation

- Use TSDoc comments for all public APIs
- Include `@typeParam` for generic type parameters
- Include `@throws` for functions that throw errors
