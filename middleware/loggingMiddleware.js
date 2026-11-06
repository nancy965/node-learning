const loggingMiddleware = (req,res,next) => {
    const startTime = Date.now();

    res.on("finish",() => {
        const responseTime = Date.now() - startTime;
        console.log (`${req.method} ${req.originalUrl} ${res.statusCode} ${responseTime}ms`);
    });
    next();
};
module.exports = loggingMiddleware;