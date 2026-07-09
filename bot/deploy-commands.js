require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  }
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Error: DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID environment variables are required.');
  console.error('Create a .env file with these values before deploying commands.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // Clean up stale global commands (if deploying to guild)
    if (GUILD_ID) {
      try {
        const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
        if (globalCommands.length > 0) {
          console.log(`Deleting ${globalCommands.length} stale global command(s)...`);
          for (const cmd of globalCommands) {
            await rest.delete(Routes.applicationCommand(CLIENT_ID, cmd.id));
          }
          console.log('Global commands cleaned up.');
        }
      } catch (err) {
        console.error('Warning: Could not clean global commands:', err.message);
      }
    }

    let data;
    if (GUILD_ID) {
      console.log(`Deploying to guild ${GUILD_ID} (instant)...`);
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
    } else {
      console.log('Deploying globally (may take up to 1 hour to propagate)...');
      data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
    }

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
})();
