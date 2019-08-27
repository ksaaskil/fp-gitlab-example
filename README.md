# Example of API interactions using FP

Adapted from [GitLabAPI.ts](https://github.com/danger/danger-js/blob/master/source/platforms/gitlab/GitLabAPI.ts) from [danger-js](https://github.com/danger/danger-js) repository.

## Post

# Using fp-ts for API requests and response validation

_How to use TaskEither, flow and pipe for smooth pipelines_

Recently I've studied a lot of functional programming, the art of function composition. Through my work on [unmock-js](https://github.com/unmock/unmock-js), I've also seen quite a few JS and TS libraries making calls to third-party APIs, so I thought it might be a fun exercise to see how one of those libraries could be rewritten in a more functional style!

As an example I chose [danger-js](https://github.com/danger/danger-js), more specifically their [GitLabAPI](https://github.com/danger/danger-js/blob/master/source/platforms/gitlab/GitLabAPI.ts) class. It's a relatively simple wrapper around the [gitlab](https://github.com/jdalrymple/node-gitlab) SDK for making API calls to the GitLab API. I'll rewrite one of the class functions to using [fp-ts](https://github.com/gcanti/fp-ts), an awesome library for functional programming in TypeScript. The full code can be found in [this repository](https://github.com/ksaaskil/fp-gitlab-example), which is a stripped down version of the `danger-js` code.

Note that there's nothing wrong with the existing `GitLabAPI` class, it's all for practice! This post is also not meant to be about the pros and cons of using functional programming versus some other programming style. I'm also not an expert in FP, so my way of rewriting the API requests in the library is not the "correct" way. Let me know in the comments if you think this made or did not make any sense!

## Getting started

Let's get to it! For fetching the user profile for the user owning the GitLab API token, `GitLabAPI` has the following function:

```typescript
class GitLabAPI {
    ...
    getUser = async (): Promise<GitLabUserProfile> => {
        debugLog("getUser");
        const user: GitLabUserProfile = (await this.api.Users.current()) as GitLabUserProfile;
        debugLog("getUser", user);
        return user;
    };
}

```

I've changed a few things here compared to the original [GitLabAPI](https://github.com/danger/danger-js/blob/b386dae748effbfb3074f58e2e17093d25d5f4f5/source/platforms/gitlab/GitLabAPI.ts). First, I added typing to `this.api` with the following additions:

```typescript
import { GitLab } from "gitlab";
...
type GitLab = InstanceType<GitLab>;

class GitLabAPI {
    this.api: GitLab;
    ...
}
```

The `GitLab` constructor is imported from [here](https://github.com/jdalrymple/node-gitlab/blob/f7425a72e24aa8209fda9079681878d34d307ec6/src/index.ts#L89). In the original code, `this.api` was typed as `any`, so all type-checks were disabled.

Because of the added type-checking, `this.api.users.current()` returns a [GetResponse](https://github.com/jdalrymple/node-gitlab/blob/6949dfddcdbb0d8eff3f6d7287bb9b237db03a9b/src/infrastructure/index.ts#L75) type instead of `any`. Therefore, one needs an explicit type-cast ("`as GitLabUserProfile`") to make the return type correct.

Alright, here's my version of `getUser` in a more FP style:

```typescript
// GitLabAPI.ts
import { Lazy } from "fp-ts/lib/function";
import { Either, left, right } from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/pipeable";
import { TaskEither } from "fp-ts/lib/TaskEither";
import TE from "./TaskEitherUtils";

...

const logValue = TE.logValueWith(debugLog);

...

getUserFp = (): TaskEither<Error, GitLabUserProfile> => {
    // I/O action for fetching user from API
    const getUserThunk: Lazy<Promise<GetResponse>> = () => {
        debugLog("getUser");
        return this.api.Users.current();
    };

    // Validate user profile
    const validateUserProfile = (
        response: object
    ): Either<Error, GitLabUserProfile> => {
        // TODO Better validation
        return hasKey(response, "id")
        ? right(response as GitLabUserProfile)
        : left(Error("Invalid user profile"));
    };

    // Pipe computations
    return pipe(
        getUserThunk,
        TE.fromThunk,
        logValue("getUser"),
        TE.chainEither(validateUserProfile)
    );
};
```

Wow, that got longer! And the snippet did not even include the helpers in `TaskEitherUtils.ts`. Let's go through this step by step.

## TaskEither 101

Let us start from the return type of our new function, `TaskEither<Error, GitLabUserProfile>`. In [fp-ts](https://github.com/gcanti/fp-ts/blob/master/src/TaskEither.ts), `TaskEither` is described as follows:

> `TaskEither<E, A>` represents an asynchronous computation that either yields a value of type `A` or fails yielding an error of type `E`.

That sounds a lot like an API call! A call to an external API is asynchronous and it definitely can fail. Also note that `TaskEither` represents a computation, _not_ the result of the computation. We can call `getUserFp` ten times without worrying about hitting the GitLab API every time.

We've made `getUserFp` a pure function: it does not have observable side effects such as logging to console, sending a HTTP request to GitLabAPI, throwing an error, or feeding a neighbor's dog. Pure functions also always return the same result for the same input: that makes them really nice to test and compose!

Let's dig deeper into `TaskEither`. It's defined as follows in `fp-ts`:

```typescript
// fp-ts/lib/TaskEither.ts
export interface TaskEither<E, A> extends Task<Either<E, A>> {}
```

Ok, so it's an alias for `Task<Either<E, A>>`. `Task` is defined [as follows](https://github.com/gcanti/fp-ts/blob/master/src/Task.ts):

```typescript
// fp-ts/lib/Task.ts
export interface Task<A> {
  (): Promise<A>;
}
```

With this definition, we can conclude that `TaskEither<E, A>` is an alias for `() => Promise<Either<E, A>>`: a _thunk_ that when called launches an asynchronous computation. The result of the computation is wrapped in a `Promise`.

The return value of the `Promise` is [Either<E, A>](https://github.com/gcanti/fp-ts/blob/master/src/Either.ts), described as follows in `fp-ts`:

> An instance of `Either` is either an instance of `Left` or `Right`.
> ... Convention dictates that `Left` is used for failure and `Right` is used for success.

So an `Either` can contain either a value representing error ("left") or a value representing success ("right").

## Creating a TaskEither

How do we create a `TaskEither` for the API call? In `getUserFp`, the following is a computation launching the API request:

```typescript
// GitLabAPI.ts
// I/O action for fetching user from API
const getUserThunk: Lazy<Promise<GetResponse>> = () => this.api.Users.current();
```

When called and awaited, it can throw. Instead, we want to wrap the computation in `TaskEither` so that it never throws, but failure is instead wrapped in the `Either` type resolved in the `Promise`. A computation like `getUserThunk` can be lifted to a `TaskEither` with the `tryCatch` function:

```typescript
// fp-ts/lib/TaskEither.ts
export function tryCatch<E, A>(
  f: Lazy<Promise<A>>,
  onRejected: (reason: unknown) => E
): TaskEither<E, A> {
  return () => f().then(a => E.right(a), reason => E.left(onRejected(reason)));
}
```

Here [Lazy<A>](https://github.com/gcanti/fp-ts/blob/master/src/function.ts#L6) is simply a synonym for a thunk returning an `A`:

```typescript
// fp-ts/lib/function.ts
export interface Lazy<A> {
  (): A;
}
```

`tryCatch` takes a thunk that returns a promise that may fail (like our `getUserThunk`) and returns a `TaskEither` containing a promise that never fails. If the original promise failed, the promise resolved from `TaskEither` will contain a "left", otherwise it's "right".

For lifting any thunk of type `() => Promise<A>` to a `TaskEither<Error, A>`, I've defined the following helper function in `TaskEitherUtils.ts`:

```typescript
// TaskEitherUtils.ts
import { toError } from "fp-ts/lib/Either.ts";

function fromThunk<A>(thunk: Lazy<Promise<A>>): TaskEither<Error, A> {
  return tryCatch(thunk, toError);
}
```

You can see this being used as the first function in the `pipe` at the end of `getUserFp`.

## Validating the response

Let us now take a look at validation. User profile is validated with the following function:

```typescript
// GitLabAPI.ts
// Validate user profile
const validateUserProfile = (
  response: object
): Either<Error, GitLabUserProfile> => {
  // TODO Better validation
  return hasKey(response, "id")
    ? right(response as GitLabUserProfile)
    : left(Error("Invalid user profile"));
};
```

Here `hasKey` is defined as

```typescript
// GitLabAPI.ts
function hasKey<K extends string>(o: {}, k: K): o is { [_ in K]: any } {
  return typeof o === "object" && k in o;
}
```

I'm being very lazy here and just checking if the response body has an `id` field (which a valid `GitLabUserProfile` should have). If it does have it, the response is cast to a `GitLabUserProfile` object and returned wrapped in a `right`, signifying successful validation. If the validation fails, we return an instance of `left` with `Error`.

In the real world, we'd probably want to validate the response using, for example, `io-ts`, a great run-time type-checking library written by the author of `fp-ts`. To keep this post a bit shorter, I won't get into that here. The important point is that the validation step returns an `Either` that we want to include in our function's return value.

## Putting it all together

Finally, everything's put together in the [pipe](https://github.com/gcanti/fp-ts/blob/master/src/pipeable.ts) at the end of the function:

```typescript
// GitLabAPI.ts
return pipe(
  getUserThunk, // Lazy<Promise<GetResponse>>
  TE.fromThunk, // -> TaskEither<Error, GetResponse>
  logValue("getUser"), // -> TaskEither<Error, GetResponse>
  TE.chainEither(validateUserProfile) // -> TaskEither<Error, GitLabUserProfile>
);
```

Here's what the typing for `pipe` looks like:

```typescript
// fp-ts/lib/pipeable.ts
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
// ...and so on
```

We can see that `pipe` takes a value of type `A` as the first argument and pipes it through the functions that follow. The type returned from the `pipe` is the return type of the last function argument.

The first function in our `pipe` is the `TE.fromThunk` that we saw above, converting the lazy promise to an `TaskEither`. The following is `logValue("getUser")`, where `logValue` is defined as follows:

```typescript
// GitLabAPI.ts
const debugLog = debug("GitLabAPI");
const logValue = TE.logValueWith(debugLog);
```

Here `debugLog` is a function used for logging and `TE.logValueWith` is defined in `TaskEitherUtils.ts` as follows:

```typescript
// TaskEitherUtils.ts
import { map } from "fp-ts/lib/TaskEither";

function logValueWith(logger: (firstArg: any, ...args: any[]) => void) {
  return <A>(logString: String) =>
    map((obj: A) => {
      logger(logString, obj);
      return obj;
    });
}
```

This function takes a logger and returns a function. The returned function takes a log string (like "getUser") and returns a `map` that can be applied to a `TaskEither` instance. `map` applies a function to the value inside `TaskEither` (if it's an instance of `right`). In our case, the value is the response returned by the API. After logging the value with `logger(logString, obj)`, the value is returned so that it's available for the next function of the `pipe`.

You might be asking if going through all this to log a single line is worth the trouble, and that's a good question. We'll talk about that at the end of this post.

Ok, final piece of the puzzle is the `TE.chainEither(validateUserProfile)`, which is the last function in our `pipe`. `TE.chainEither` is defined as follows:

```typescript
// TaskEitherUtils.ts
import { flow } from "fp-ts/lib/function";
import { chain, TaskEither, fromEither } from "fp-ts/lib/TaskEither";
import { Either } from "fp-ts/lib/Either";

function chainEither<A, B>(
  f: (a: A) => Either<Error, B>
): (ma: TaskEither<Error, A>) => TaskEither<Error, B> {
  return chain(
    flow(
      f,
      fromEither
    )
  );
}
```

Let's first look at the type. It takes a function of the type `f: (a: A) => Either<Error, B>`. This is the type of our validation function, with `A` and `B` replaced by `GetResponse` and `GitLabUserProfile`, respectively. `chainEither` returns a function of type `(ma: TaskEither<Error, A>) => TaskEither<Error, B>`. Replacing `B` with `GitLabUserProfile`, we see that this function fits as last part of the pipe.

Ok, the types make sense, so let's look at the implementation. The `chain` is a function that's used for mapping the value wrapped inside `TaskEither` with a function that returns a `TaskEither`. This can be a bit confusing, so I'll try to clarify the types:

```typescript
const getResponseTe: TaskEither<Error, GetResponse> = ...  // This is our TaskEither
const validateUserProfile = (getResponseTe: GetResponse) => TaskEither<Error, GitLabUserProfile> = ...  // This is the validation function we want apply to `a: GetResponse`
chain(validateUserProfile)  // Function with signature: `TaskEither<Error, GetResponse>` => `TaskEither<Error, GitLabUserProfile>`
chain(validateUserProfile)(getResponseTe)  // TaskEither<Error, GitLabUserProfile>
```

This would be perfect for us, if the validation function returned a `TaskEither`. But I cheated: it returns an `Either`. So it was all for nothing!

JK, it wasn't! `TaskEither.ts` has a function called `fromEither` for creating an `Either` from a `TaskEither`. So if we apply that to the result of validation, we'll have composed a function of type `GetResponse => TaskEither<Error, GitLabUserProfile>`. And then we use `chain` to get a function of type `TaskEither<Error, GetResponse>` to `TaskEither<Error, GitLabUserProfile>`.

In `fp-ts`, functions can be composed with `flow` from `fp-ts/lib/function.ts`. Here is its type definition:

```typescript
// fp-ts/lib/function.ts
export function flow<A extends Array<unknown>, B>(
  ab: (...a: A) => B
): (...a: A) => B;
export function flow<A extends Array<unknown>, B, C>(
  ab: (...a: A) => B,
  bc: (b: B) => C
): (...a: A) => C;
// ...and so on
```

In our `chainEither`, `flow(f, fromEither)` is a function composition from left to right: it's a function that first applies `f` (the validation) and then applies `fromEither` (to make the type compatible with `chain`).

That concludes our rewrite of `getUser`!

## Why's it so long?

Clearly the method `getUser` got a lot longer in my rewrite. However, there are a few points one can make here in the FP style's defence.

First, we wrote a lot of helper functions. Without the helpers, we would have been able to cut the number of lines to following:

```typescript
// GitLabAPI.ts
// getUserFpShort
    return pipe(
      () => {
        debugLog("getUser");
        return this.api.Users.current();
      },
      thunk => tryCatch(thunk, toError),
      map((obj: GetResponse) => {
        debugLog("getUser", obj);
        return obj;
      }),
      chain(
        flow(
          validateUserProfile,
          fromEither
        )
      )
```

That's not so much longer than the original function. However, we have lost reusability: re-writing the rest of the functions in FP style requires duplicating code. With the helper functions, it becomes rather trivial.

Second, the function is now pure and the return type is an abstract data type with a rich set of combinators. One can therefore easily compose longer pipelines from smaller functions using all the combinators available for `TaskEither`.

Third, we added an explicit validation step that was done only implicitly (`as GitLabUserProfile`) in the original function, so that also added a few lines.

### Was it worth it?

Finally, one can ponder whether it's worth the effort to refactor the methods in `GitLabAPI` to be pure functions returning `TaskEither`s. I think that depends on how the `GitLabAPI` class is used. If the user of the class immediately throws away `TaskEither` by awaiting the promise and checking for error, we have only added unnecessary complexity and replaced a `try-catch` block with `isLeft` check.

On the other hand, if the user of the class takes the `TaskEither` and composes it with other tasks to create bigger stories, I think the more FP-like solution might be in place. One could also take a bit softer stand on purity and allow functions to log to console at will.

This was my first post in dev.to! I hope someone finds it useful: I learned a lot of `fp-ts` writing it and also got lot of satisfaction for the successful type-checks. Thank you for reading and sharing your comments!

## Resources

- [Getting started with fp-ts](https://dev.to/gcanti/getting-started-with-fp-ts-setoid-39f3) series
- [Interoperability with non-functional code using fp-ts](https://dev.to/gcanti/interoperability-with-non-functional-code-using-fp-ts-432e): useful article mentioning `TaskEither`
- [Learn you a Haskell](http://learnyouahaskell.com/) book: "the funkiest way to learn Haskell"
