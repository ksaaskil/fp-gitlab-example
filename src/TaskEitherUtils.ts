import { flow, Lazy } from "fp-ts/lib/function";
import {
  chain,
  TaskEither,
  tryCatch,
  map,
  fromEither,
} from "fp-ts/lib/TaskEither";
import { Either, toError } from "fp-ts/lib/Either";

function logValueWith(logger: (firstArg: any, ...args: any[]) => void) {
  return <A>(logString: String) =>
    map((obj: A) => {
      logger(logString, obj);
      return obj;
    });
}

/**
 * Lift a computation to TaskEither, essentially: () => Promise<Either<Error, A>>
 * TaskEither<E, A> is a synonym for
 * Task<Either<E, A>>, where Task<B> is a synonym for
 * () => Promise<B>.
 * @param thunk I/O action returning a promise
 */
function fromThunk<A>(thunk: Lazy<Promise<A>>): TaskEither<Error, A> {
  return tryCatch(thunk, toError);
}

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

export default {
  logValueWith,
  fromThunk,
  chainEither,
};
