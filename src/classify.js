/**
 * Decides what a GraphQL response says about our joinTaskQueue call.
 * Shared by the page interceptor and the Node tests.
 */
(function (root) {
  const OPERATION = 'joinTaskQueue';
  const FULL_CODE = 'RESOURCE_EXHAUSTED';
  const FULL_MESSAGE = /queue is full/i;

  function ownErrors(body) {
    if (!Array.isArray(body.errors)) return [];
    return body.errors.filter(
      (error) => Array.isArray(error && error.path) && error.path.includes(OPERATION)
    );
  }

  function mentionsOperation(body) {
    if (!body || typeof body !== 'object') return false;
    const inData = body.data && Object.prototype.hasOwnProperty.call(body.data, OPERATION);
    return Boolean(inData) || ownErrors(body).length > 0;
  }

  function isQueueFull(error) {
    const code = error.extensions && error.extensions.service_exception_code;
    return code === FULL_CODE || FULL_MESSAGE.test(error.message || '');
  }

  /**
   * @param {string} text raw response body
   * @returns {{status: 'full'|'joined'|'error', message?: string} | null}
   *          null when the response has nothing to do with joining the queue.
   */
  function classifyJoinResponse(text) {
    if (typeof text !== 'string' || !text.includes(OPERATION)) return null;

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      return null;
    }

    const bodies = (Array.isArray(payload) ? payload : [payload]).filter(Boolean);
    if (!bodies.some(mentionsOperation)) return null;

    const errors = bodies.flatMap(ownErrors);
    if (errors.length === 0) return { status: 'joined' };

    const full = errors.find(isQueueFull);
    if (full) return { status: 'full', message: full.message };

    return { status: 'error', message: errors[0].message };
  }

  root.__queueRefreshClassify = classifyJoinResponse;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classifyJoinResponse };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
