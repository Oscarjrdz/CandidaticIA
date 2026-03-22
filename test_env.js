async function run() {
    console.log("ENV INSTANCE:", process.env.ULTRAMSG_INSTANCE_ID);
    console.log("ENV TOKEN:", process.env.ULTRAMSG_TOKEN);
    process.exit(0);
}
run();
